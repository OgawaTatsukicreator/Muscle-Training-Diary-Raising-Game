// Execute real migrations against a new in-memory PostgreSQL (PGlite) instance.
// The optional argument is a separate npm prefix containing @electric-sql/pglite.
// This script does not read .env files or connect to any external database.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const requireRuntime = createRequire(
  process.argv[2] ? resolve(process.argv[2], "package.json") : import.meta.url,
);
const { PGlite } = requireRuntime("@electric-sql/pglite");
const { pgcrypto } = requireRuntime("@electric-sql/pglite/contrib/pgcrypto");
const db = new PGlite({ extensions: { pgcrypto } });
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const LEGACY = "33333333-3333-4333-8333-333333333333";
const request = (number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, "0")}`;
const tables = [
  "exercises", "food_exchange_logs", "food_logs", "foods", "growth_logs",
  "maso_status", "profiles", "reward_ledger", "user_settings", "workout_logs",
];
const ownerColumn = (table) => table === "profiles" ? "id" : "user_id";
let checks = 0;

async function check(label, action) {
  await action();
  checks += 1;
  console.log(`ok ${checks} - ${label}`);
}

async function rows(sql, params = []) {
  return (await db.query(sql, params)).rows;
}

async function one(sql, params = []) {
  const result = await rows(sql, params);
  assert.equal(result.length, 1, "expected exactly one row");
  return result[0];
}

// Every role switch runs inside a rollback-only transaction, except intentional
// positive fixtures. A failure therefore cannot leave the next check privileged.
async function asUser(user, action, { commit = false, broadenGrants = false } = {}) {
  await db.exec("begin");
  try {
    if (broadenGrants) {
      await db.exec("grant select, insert, update, delete on all tables in schema public to authenticated");
    }
    const role = user === null ? "anon" : "authenticated";
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? ""]);
    await db.query("select set_config('request.jwt.claim.role', $1, true)", [role]);
    await db.exec(`set local role ${role}`);
    const result = await action();
    await db.exec(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

async function denied(user, sql, params = [], expectedCode = "42501", options) {
  await assert.rejects(
    () => asUser(user, () => db.query(sql, params), options),
    (error) => error.code === expectedCode,
    `expected PostgreSQL SQLSTATE ${expectedCode}`,
  );
}

async function snapshot(user) {
  const result = {};
  for (const table of tables) {
    result[table] = await rows(
      `select to_jsonb(t) as row from public.${table} t where ${ownerColumn(table)} = $1 order by to_jsonb(t)::text`,
      [user],
    );
  }
  return result;
}

const saveSql = "select public.save_workout($1, '2026-01-01', $2, 'kg', 100, 2, 'isolation fixture', $3) as result";
const exchangeSql = "select public.exchange_food($1, $2, $3, $4) as result";
const feedSql = "select public.feed_maso_item($1, $2, $3, $4) as result";
const renameSql = "select public.rename_maso($1, $2) as result";

try {
  // Only the Auth surface needed by the actual migrations is supplied here.
  // JWT verification and issuance belong to Supabase Auth and are not simulated.
  await db.exec(`
    create role anon nologin nosuperuser nobypassrls;
    create role authenticated nologin nosuperuser nobypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role', true), '')
    $$;
    grant usage on schema public, auth to anon, authenticated;
  `);
  await db.query("insert into auth.users (id) values ($1)", [LEGACY]);
  console.log(`engine: ${(await one("select version() as version")).version}`);

  const migrationDirectory = new URL("../migrations/", import.meta.url);
  const migrations = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort();
  assert.ok(migrations.length >= 2, "expected the initial and food RPC migrations");
  for (const name of migrations) {
    const sql = readFileSync(new URL(name, migrationDirectory), "utf8");
    console.log(`migration: ${name} sha256=${createHash("sha256").update(sql).digest("hex")}`);
    await check(`apply unmodified migration ${name}`, () => db.exec(sql));
  }

  await check("every public user-data table has RLS enabled", async () => {
    const catalog = await rows("select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by c.relname");
    assert.deepEqual(catalog.map((row) => row.relname), tables);
    assert.ok(catalog.every((row) => row.relrowsecurity));
  });
  await check("application roles cannot bypass RLS or act as superuser", async () => {
    const roles = await rows("select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('anon', 'authenticated')");
    assert.equal(roles.length, 2);
    assert.ok(roles.every((role) => !role.rolsuper && !role.rolbypassrls));
  });
  await check("migration backfills a pre-existing Auth account", async () => {
    const initial = await snapshot(LEGACY);
    for (const table of ["profiles", "user_settings", "maso_status", "foods"]) assert.equal(initial[table].length, 1);
    assert.equal(initial.exercises.length, 14);
  });

  await db.query("insert into auth.users (id, raw_user_meta_data) values ($1, $2), ($3, $4)", [
    A, { display_name: " Alice " }, B, { display_name: "   " },
  ]);
  const exercises = {};
  for (const user of [A, B]) {
    await check(`registration creates independent defaults for ${user[0]}`, () => asUser(user, async () => {
      const context = await one("select current_user, auth.uid() as uid, auth.role() as role");
      assert.deepEqual(context, { current_user: "authenticated", uid: user, role: "authenticated" });
      const profile = await one("select * from public.profiles");
      assert.equal(profile.id, user);
      assert.equal(profile.display_name, user === A ? "Alice" : "トレーニー");
      assert.equal((await one("select * from public.user_settings")).default_sets, 3);
      const maso = await one("select * from public.maso_status");
      assert.equal(maso.level, 1);
      assert.equal(maso.growth_points, 0);
      const food = await one("select * from public.foods");
      assert.equal(food.balance, 0);
      assert.equal(food.protein_balance, 0);
      const defaults = await rows("select * from public.exercises order by name");
      assert.equal(defaults.length, 14);
      assert.ok(defaults.every((exercise) => exercise.user_id === user && exercise.is_default));
      exercises[user] = defaults[0].id;
    }));
    await check(`own profile, settings and custom exercise writes succeed for ${user[0]}`, () => asUser(user, async () => {
      assert.equal((await rows("update public.profiles set display_name = 'My profile' returning id")).length, 1);
      assert.equal((await rows("update public.user_settings set default_sets = 4, weight_unit = 'lb' returning user_id")).length, 1);
      const custom = await one("insert into public.exercises (user_id, name, body_part) values ($1, 'My exercise', 'other') returning id, is_default", [user]);
      assert.equal(custom.is_default, false);
      assert.equal((await rows("update public.exercises set name = 'Renamed exercise' where id = $1 returning id", [custom.id])).length, 1);
    }, { commit: true }));
    await check(`workout RPC credits only account ${user[0]}`, () => asUser(user, async () => {
      const result = (await one(saveSql, [exercises[user], user === A ? 100 : 80, request(1)])).result;
      assert.equal(result.created, true);
      assert.equal(result.growthPoints, user === A ? 200 : 160);
      assert.equal(result.food, 0);
      const log = await one("select * from public.workout_logs");
      assert.equal(log.user_id, user);
      assert.equal(log.volume_kg, user === A ? "20000.000" : "16000.000");
    }, { commit: true }));
    await check(`exchange, feed, level-up and rename affect account ${user[0]}`, () => asUser(user, async () => {
      assert.equal((await one(exchangeSql, ["onigiri", 10, request(2), user])).result.created, true);
      assert.equal((await one(exchangeSql, ["protein", 4, request(3), user])).result.created, true);
      const rice = (await one(feedSql, ["onigiri", 10, request(4), user])).result;
      assert.equal(rice.level, 2);
      assert.equal(rice.experience, 0);
      const protein = (await one(feedSql, ["protein", 2, request(5), user])).result;
      assert.equal(protein.protein, 2);
      assert.equal(protein.experience, 60);
      assert.equal((await one(renameSql, [`Maso ${user[0]}`, user])).result.name, `Maso ${user[0]}`);
      assert.equal((await one("select * from public.maso_status")).growth_points, user === A ? 90 : 50);
    }, { commit: true }));
    await check(`replaying own requests is idempotent for account ${user[0]}`, () => asUser(user, async () => {
      assert.equal((await one(saveSql, [exercises[user], user === A ? 100 : 80, request(1)])).result.created, false);
      assert.equal((await one(exchangeSql, ["onigiri", 10, request(2), user])).result.created, false);
      assert.equal((await one(feedSql, ["protein", 2, request(5), user])).result.created, false);
    }));
  }
  assert.notEqual(exercises[A], exercises[B]);
  const beforeA = await snapshot(A);
  const beforeB = await snapshot(B);

  const mutable = { profiles: "display_name", user_settings: "default_sets", exercises: "name" };
  for (const user of [A, B]) {
    const other = user === A ? B : A;
    for (const table of tables) {
      const owner = ownerColumn(table);
      const column = mutable[table] ?? owner;
      await check(`${user[0]} sees own ${table} and cannot select another account`, () => asUser(user, async () => {
        const ownRows = await rows(`select * from public.${table}`);
        assert.ok(ownRows.length > 0, "fixtures must populate every table");
        assert.ok(ownRows.every((row) => row[owner] === user));
        assert.deepEqual(await rows(`select * from public.${table} where ${owner} = $1`, [other]), []);
      }));
      const insertSql = table === "exercises"
        ? "insert into public.exercises (user_id, name, body_part) values ($1, 'Foreign forged exercise', 'other')"
        : `insert into public.${table} (${owner}) values ($1)`;
      await check(`${user[0]} cannot insert another account's ${table}`, () => denied(user, insertSql, [other]));
      await check(`${user[0]} cannot update another account's ${table}`, async () => {
        const sql = `update public.${table} set ${column} = ${column} where ${owner} = $1 returning ${owner}`;
        if (mutable[table]) assert.deepEqual(await asUser(user, () => rows(sql, [other])), []);
        else await denied(user, sql, [other]);
      });
      await check(`${user[0]} cannot delete another account's ${table}`, () => denied(user, `delete from public.${table} where ${owner} = $1`, [other]));
      await check(`${user[0]} cannot reassign ${table} ownership`, () => denied(user, `update public.${table} set ${owner} = $1 where ${owner} = $2`, [other, user]));
    }
    await check(`${user[0]} cannot use another account's exercise through RPC`, () => denied(user, saveSql, [exercises[other], 100, request(6)], "P0002"));
    for (const [name, sql, params] of [
      ["exchange", exchangeSql, ["onigiri", 1, request(7), other]],
      ["feed", feedSql, ["protein", 1, request(8), other]],
      ["rename", renameSql, ["Hijacked", other]],
    ]) {
      await check(`${user[0]} cannot forge expected_user_id in ${name} RPC`, () => denied(user, sql, params));
      await check(`${user[0]} cannot omit expected_user_id in ${name} RPC`, () => denied(user, sql, [...params.slice(0, -1), null]));
    }
    for (const [name, sql, params] of [
      ["workout", saveSql, [exercises[user], 101, request(1)]],
      ["exchange", exchangeSql, ["protein", 10, request(2), user]],
      ["feed", feedSql, ["protein", 1, request(5), user]],
    ]) {
      await check(`${user[0]} cannot change payload on ${name} replay`, () => denied(user, sql, params, "22023"));
    }
    await check(`${user[0]} cannot call retired feed RPC`, () => denied(user, "select public.feed_maso(1, $1)", [request(9)]));
    await check(`${user[0]} cannot call retired rename RPC`, () => denied(user, "select public.rename_maso('Legacy')"));
  }

  // Verify RLS independently of the restrictive application grants. Any extra
  // permissions exist only in this check's rollback-only, in-memory transaction.
  for (const table of tables) {
    const owner = ownerColumn(table);
    await check(`RLS itself hides foreign UPDATE/DELETE on ${table} even with broad grants`, () => asUser(A, async () => {
      assert.deepEqual(await rows(`update public.${table} set ${owner} = ${owner} where ${owner} = $1 returning ${owner}`, [B]), []);
      assert.deepEqual(await rows(`delete from public.${table} where ${owner} = $1 returning ${owner}`, [B]), []);
    }, { broadenGrants: true }));
    // Copy a structurally valid foreign row to ensure RLS, not missing columns,
    // rejects the INSERT. Generated columns must be left for PostgreSQL to fill.
    const columns = (await rows("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER' order by ordinal_position", [table])).map((row) => row.column_name);
    const fixture = (await snapshot(B))[table][0].row;
    await check(`RLS itself rejects foreign INSERT on ${table} even with broad grants`, () => denied(A,
      `insert into public.${table} (${columns.join(", ")}) select ${columns.join(", ")} from jsonb_populate_record(null::public.${table}, $1::jsonb)`,
      [fixture], "42501", { broadenGrants: true },
    ));
  }

  for (const table of tables) {
    const owner = ownerColumn(table);
    for (const [operation, sql] of [
      ["SELECT", `select * from public.${table}`],
      ["INSERT", `insert into public.${table} (${owner}) values ($1)`],
      ["UPDATE", `update public.${table} set ${owner} = $1`],
      ["DELETE", `delete from public.${table} where ${owner} = $1`],
    ]) {
      await check(`anon cannot ${operation} ${table}`, () => denied(null, sql, operation === "SELECT" ? [] : [A]));
    }
  }
  for (const [name, sql, params] of [
    ["workout", saveSql, [exercises[A], 100, request(10)]],
    ["exchange", exchangeSql, ["onigiri", 1, request(11), A]],
    ["feed", feedSql, ["protein", 1, request(12), A]],
    ["rename", renameSql, ["Anon", A]],
  ]) {
    await check(`anon cannot execute ${name} RPC`, () => denied(null, sql, params));
    await check(`authenticated role without user identity cannot execute ${name} RPC`, () => denied("", sql, params, "28000"));
  }
  await check("RPC has no arbitrary p_user_id parameter", () => denied(A,
    "select public.save_workout(p_exercise_id => $1::uuid, p_workout_date => '2026-01-01'::date, p_weight => 10::numeric, p_unit => 'kg'::text, p_reps => 1, p_sets => 1, p_memo => ''::text, p_request_id => $2::uuid, p_user_id => $3::uuid)",
    [exercises[A], request(13), B], "42883",
  ));
  await check("authenticated users cannot insert identities into auth.users", () => denied(A, "insert into auth.users (id) values ($1)", [request(14)]));
  await check("authenticated users cannot mark custom exercises as system defaults", () => denied(A, "update public.exercises set is_default = true where user_id = $1", [A]));

  // Composite foreign keys are an additional boundary, including for privileged
  // jobs that do not use application RLS policies.
  await check("workout composite foreign key rejects an exercise owned by another account", async () => {
    await assert.rejects(() => db.query("insert into public.workout_logs (user_id, exercise_id, client_request_id, workout_date, weight_kg, reps, sets) values ($1, $2, $3, '2026-01-01', 10, 1, 1)", [A, exercises[B], request(15)]), (error) => error.code === "23503");
  });
  await check("ledger composite foreign key rejects another account's workout", async () => {
    const workoutB = beforeB.workout_logs[0].row.id;
    await assert.rejects(() => db.query("insert into public.reward_ledger (user_id, workout_log_id, event_type, request_id) values ($1, $2, 'workout_reward', $3)", [A, workoutB, request(16)]), (error) => error.code === "23503");
  });
  await check("all denied, anonymous and replay operations leave both accounts unchanged", async () => {
    assert.deepEqual(await snapshot(A), beforeA);
    assert.deepEqual(await snapshot(B), beforeB);
  });
  console.log(`PASS: ${checks} PostgreSQL execution checks; no remote database contacted.`);
} finally {
  await db.close();
}
