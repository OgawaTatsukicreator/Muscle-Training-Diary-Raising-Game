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
  "body_weight_logs", "exercises", "food_exchange_logs", "food_logs", "foods", "growth_logs",
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
const saveFullSql = "select public.save_workout($1, $2, $3, $4, $5, $6, '', $7, $8, $9) as result";
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
    assert.equal(initial.exercises.length, 61);
    const squat = initial.exercises.find((item) => item.row.master_key === "default-squat").row;
    assert.equal(squat.name, "バーベルスクワット");
    assert.equal(squat.calculation_pattern, "B");
    assert.equal(Number(squat.bw_ratio), 0.88);
    const pushUp = initial.exercises.find((item) => item.row.master_key === "default-push-up").row;
    assert.equal(pushUp.calculation_pattern, "C");
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
      assert.equal(defaults.length, 61);
      assert.ok(defaults.every((exercise) => exercise.user_id === user && exercise.is_default && exercise.master_key));
      exercises[user] = defaults.find((exercise) => exercise.master_key === "default-bench-press").id;
    }));
    await check(`own profile, settings and custom exercise writes succeed for ${user[0]}`, () => asUser(user, async () => {
      assert.equal((await rows("update public.profiles set display_name = 'My profile' returning id")).length, 1);
      assert.equal((await rows("update public.user_settings set default_sets = 4, weight_unit = 'lb' returning user_id")).length, 1);
      const custom = (await one("select public.add_exercise('My exercise', 'other') as result")).result;
      assert.equal(custom.isDefault, false);
      assert.equal(custom.created, true);
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
    await check(`body weight is stored once per day for account ${user[0]}`, () => asUser(user, async () => {
      assert.equal(Number((await one("select public.save_body_weight('2026-01-01', 68.5) as result")).result.weightKg), 68.5);
      assert.equal(Number((await one("select public.save_body_weight('2026-01-01', 69) as result")).result.weightKg), 69);
      const logs = await rows("select * from public.body_weight_logs");
      assert.equal(logs.length, 1);
      assert.equal(logs[0].user_id, user);
      assert.equal(Number(logs[0].weight_kg), 69);
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
  // ---- Load calculation (migration 0003). The expected numbers are shared
  // with lib/domain/load.test.ts so the SQL and TypeScript engines stay aligned.
  const master = async (user, key) => (await asUser(user, () => one("select id from public.exercises where master_key = $1", [key]))).id;
  const bodyDate = "2026-01-02";
  const fixtures = [
    ["B squat adds 0.88 of body weight", "default-squat", [100, "kg", 5, 3, 70, 0], "161.6000", "2424.000"],
    ["C push-up uses 0.64 of body weight", "default-push-up", [0, "kg", 20, 3, 70, 0], "44.8000", "2688.000"],
    ["D pull-up subtracts assistance", "pull-up", [0, "kg", 8, 3, 70, 20], "43.0000", "1032.000"],
    ["D weighted dip adds belt weight", "dips", [10, "kg", 5, 2, 70, 0], "73.7000", "737.000"],
    ["C isometric plank counts 10 seconds as one rep", "default-plank", [0, "kg", 60, 2, 70, 0], "4.5500", "546.000"],
    ["A bench press converts pounds", "default-bench-press", [135, "lb", 10, 3, null, 0], "61.2350", "1837.050"],
  ];
  let requestNumber = 100;
  for (const [label, key, [weight, unit, reps, sets, bodyWeight, assist], load, volume] of fixtures) {
    requestNumber += 1;
    const current = requestNumber;
    await check(`save_workout: ${label}`, async () => {
      const exercise = await master(A, key);
      await asUser(A, async () => {
        const result = (await one(saveFullSql, [exercise, bodyDate, weight, unit, reps, sets, request(current), bodyWeight, assist])).result;
        assert.equal(Number(result.loadPerUnitKg).toFixed(4), load);
        assert.equal(Number(result.volumeKg).toFixed(3), volume);
        assert.equal(result.growthPoints, Math.floor(Number(volume) / 100));
      });
    });
  }
  await check("those fixture workouts were rolled back", async () => {
    assert.equal((await rows("select 1 from public.workout_logs where workout_date = $1", [bodyDate])).length, 0);
  });
  await check("save_workout uses the latest earlier body weight when none is sent", () => asUser(A, async () => {
    const pullUp = (await one("select id from public.exercises where master_key = 'pull-up'")).id;
    const result = (await one(saveFullSql, [pullUp, "2026-01-05", 0, "kg", 5, 1, request(150), null, 0])).result;
    // The 2026-01-01 body weight (69 kg) x 0.9
    assert.equal(Number(result.loadPerUnitKg).toFixed(4), "62.1000");
    assert.equal(Number(result.bodyWeightKg), 69);
  }));
  await check("save_workout stores the sent body weight as that day's weight", () => asUser(A, async () => {
    const squat = (await one("select id from public.exercises where master_key = 'default-squat'")).id;
    await one(saveFullSql, [squat, "2026-01-03", 50, "kg", 5, 1, request(151), 72, 0]);
    const day = await rows("select weight_kg from public.body_weight_logs where log_date = '2026-01-03'");
    assert.equal(day.length, 1);
    assert.equal(Number(day[0].weight_kg), 72);
    const log = await one("select * from public.workout_logs where client_request_id = $1", [request(151)]);
    assert.equal(Number(log.body_weight_kg), 72);
    assert.equal(Number(log.load_per_unit_kg).toFixed(4), "113.3600");
  }));
  await check("a weight-only exercise still records a body weight sent with it", () => asUser(A, async () => {
    await one(saveFullSql, [exercises[A], "2026-01-04", 60, "kg", 5, 1, request(152), 71.25, 0]);
    assert.equal(Number((await one("select weight_kg from public.body_weight_logs where log_date = '2026-01-04'")).weight_kg), 71.25);
  }));
  await check("a body-weight exercise needs a body weight when none was ever recorded", async () => {
    const pullUp = await master(LEGACY, "pull-up");
    await denied(LEGACY, saveFullSql, [pullUp, "2026-01-02", 0, "kg", 5, 1, request(153), null, 0], "22023");
    await asUser(LEGACY, async () => {
      const result = (await one(saveFullSql, [pullUp, "2026-01-02", 0, "kg", 5, 1, request(153), 80, 0])).result;
      assert.equal(Number(result.loadPerUnitKg).toFixed(4), "72.0000");
    });
  });
  const invalidCases = [
    ["a weight-only exercise rejects zero weight", "default-bench-press", [0, "kg", 10, 3, null, 0]],
    ["weights over 500 kg are rejected", "default-bench-press", [501, "kg", 1, 1, null, 0]],
    ["weights over 500 kg are rejected after pound conversion", "default-bench-press", [1200, "lb", 1, 1, null, 0]],
    ["more than 200 reps is rejected", "default-bench-press", [20, "kg", 201, 1, null, 0]],
    ["more than 600 seconds is rejected for isometric exercises", "default-plank", [0, "kg", 601, 1, 70, 0]],
    ["more than 30 sets is rejected", "default-bench-press", [20, "kg", 10, 31, null, 0]],
    ["assistance equal to the whole load is rejected", "pull-up", [0, "kg", 5, 1, 70, 63]],
    ["a body weight under 20 kg is rejected", "default-push-up", [0, "kg", 5, 1, 19, 0]],
    ["a body weight over 300 kg is rejected", "default-push-up", [0, "kg", 5, 1, 301, 0]],
    ["a record over 50,000 kg of volume is rejected", "default-bench-press", [200, "kg", 200, 2, null, 0]],
    ["negative assistance is rejected", "pull-up", [0, "kg", 5, 1, 70, -1]],
  ];
  for (const [label, key, [weight, unit, reps, sets, bodyWeight, assist]] of invalidCases) {
    requestNumber += 1;
    const current = requestNumber;
    await check(`save_workout validation: ${label}`, async () => {
      const exercise = await master(A, key);
      await denied(A, saveFullSql, [exercise, bodyDate, weight, unit, reps, sets, request(current), bodyWeight, assist], "22023");
    });
  }
  await check("a replay with a different assistance or body weight is rejected", async () => {
    const pullUp = await master(A, "pull-up");
    await asUser(A, async () => { await one(saveFullSql, [pullUp, bodyDate, 0, "kg", 8, 3, request(160), 70, 20]); }, { commit: true });
    await asUser(A, async () => {
      assert.equal((await one(saveFullSql, [pullUp, bodyDate, 0, "kg", 8, 3, request(160), null, 20])).result.created, false);
    });
    await denied(A, saveFullSql, [pullUp, bodyDate, 0, "kg", 8, 3, request(160), null, 10], "22023");
    await denied(A, saveFullSql, [pullUp, bodyDate, 0, "kg", 8, 3, request(160), 71, 20], "22023");
  });
  await check("save_body_weight rejects future dates and out-of-range values", async () => {
    await denied(A, "select public.save_body_weight('2999-01-01', 70)", [], "22023");
    await denied(A, "select public.save_body_weight('2026-01-01', 19.9)", [], "22023");
    await denied(A, "select public.save_body_weight('2026-01-01', 300.1)", [], "22023");
  });
  await check("add_exercise derives the calculation pattern from the body part", () => asUser(A, async () => {
    const make = async (name, part, usesBodyweight, isometric) =>
      (await one("select public.add_exercise($1, $2, $3, $4) as result", [name, part, usesBodyweight, isometric])).result;
    const legsBodyweight = await make("Jump squat", "legs", true, false);
    assert.deepEqual([legsBodyweight.calculationPattern, Number(legsBodyweight.bwRatio), legsBodyweight.isIsometric], ["B", 0.74, false]);
    const legsMachine = await make("Sled push", "legs", false, true);
    assert.deepEqual([legsMachine.calculationPattern, Number(legsMachine.bwRatio), legsMachine.isIsometric], ["A", 0, false]);
    const absTimed = await make("Hollow hold", "abs", false, true);
    assert.deepEqual([absTimed.calculationPattern, Number(absTimed.bwRatio), absTimed.isIsometric], ["C", 0.5, true]);
    const absReps = await make("Toe touch", "abs", true, false);
    assert.deepEqual([absReps.calculationPattern, Number(absReps.bwRatio), absReps.isIsometric], ["C", 0.5, false]);
    const chest = await make("Svend press", "chest", true, true);
    assert.deepEqual([chest.calculationPattern, Number(chest.bwRatio), chest.isIsometric], ["A", 0, false]);
    const again = await make("  svend   PRESS ", "chest", false, false);
    assert.equal(again.created, false);
    assert.equal(again.id, chest.id);
  }));
  await check("add_exercise rejects blank names and unknown body parts", async () => {
    await denied(A, "select public.add_exercise('   ', 'chest')", [], "22023");
    await denied(A, "select public.add_exercise('x', 'neck')", [], "22023");
  });
  await check("exercise_master has 61 unique exercises and is not callable by app roles", async () => {
    const master61 = await one("select count(*)::int as n, count(distinct master_key)::int as keys from public.exercise_master()");
    assert.deepEqual([master61.n, master61.keys], [61, 61]);
    await denied(A, "select * from public.exercise_master()");
    await denied(null, "select * from public.exercise_master()");
  });
  await check("the retired 8-argument save_workout no longer exists", async () => {
    const functions = await rows("select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'save_workout'");
    assert.equal(functions.length, 1);
    assert.ok(functions[0].args.includes("p_body_weight_kg"));
  });

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
      if (table === "exercises") {
        await check(`${user[0]} cannot insert exercises directly, even for self`, () => denied(user, insertSql, [user]));
        await check(`${user[0]} cannot change an exercise's calculation pattern`, () => denied(user, "update public.exercises set calculation_pattern = 'D', bw_ratio = 1 where user_id = $1", [user]));
        await check(`${user[0]} cannot change an exercise's body part`, () => denied(user, "update public.exercises set body_part = 'legs' where user_id = $1", [user]));
      }
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
    ["add exercise", "select public.add_exercise($1, 'chest') as result", ["Anon exercise"]],
    ["body weight", "select public.save_body_weight('2026-01-01', $1) as result", [70]],
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
    await assert.rejects(() => db.query("insert into public.workout_logs (user_id, exercise_id, client_request_id, workout_date, weight_kg, load_per_unit_kg, reps, sets) values ($1, $2, $3, '2026-01-01', 10, 10, 1, 1)", [A, exercises[B], request(15)]), (error) => error.code === "23503");
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
