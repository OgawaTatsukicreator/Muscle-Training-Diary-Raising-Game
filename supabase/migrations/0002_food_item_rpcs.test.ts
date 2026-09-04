import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("./0002_food_item_rpcs.sql", import.meta.url),
  "utf8",
);

function rpcBody(
  name: "exchange_food" | "feed_maso_item" | "rename_maso",
): string {
  const start = sql.indexOf(`create or replace function public.${name}`);
  const next = sql.indexOf("create or replace function public.", start + 1);

  return sql.slice(start, next === -1 ? sql.length : next);
}

describe("food item Supabase migration contract", () => {
  it("adds a non-negative protein inventory", () => {
    expect(sql).toContain("add column protein_balance integer not null default 0");
    expect(sql).toContain("check (protein_balance >= 0)");
  });

  it("publishes both authenticated security-definer RPC signatures", () => {
    for (const name of ["exchange_food", "feed_maso_item"] as const) {
      const body = rpcBody(name);

      expect(body).toContain(`create or replace function public.${name}(`);
      expect(body).toContain("p_kind text");
      expect(body).toContain("p_amount integer");
      expect(body).toContain("p_request_id uuid");
      expect(body).toContain("p_expected_user_id uuid");
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = ''");
      expect(body).toContain("v_user_id uuid := auth.uid()");
      expect(body).toContain("'authentication required'");
      expect(body).toContain("p_expected_user_id <> v_user_id");
      expect(body).toContain("'authentication context changed'");
      expect(body).toContain("'onigiri', 'protein'");
    }

    for (const signature of [
      "public.save_workout(uuid, date, numeric, text, integer, integer, text, uuid)",
      "public.exchange_food(text, integer, uuid, uuid)",
      "public.feed_maso_item(text, integer, uuid, uuid)",
      "public.rename_maso(text, uuid)",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function ${signature.replace(/[().]/g, "\\$&")}\\s+from public, anon, authenticated;`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function ${signature.replace(/[().]/g, "\\$&")}\\s+to authenticated;`,
        ),
      );
    }

    expect(sql).toMatch(
      /revoke all on function public\.feed_maso\(integer, uuid\)\s+from public, anon, authenticated;/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.feed_maso\(integer, uuid\)[\s\S]*?to authenticated;/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.rename_maso\(text\)\s+from public, anon, authenticated;/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.rename_maso\(text\)[\s\S]*?to authenticated;/,
    );
  });

  it("binds account-only RPC intents to the visible account", () => {
    for (const name of [
      "exchange_food",
      "feed_maso_item",
      "rename_maso",
    ] as const) {
      const body = rpcBody(name);

      expect(body).toContain("p_expected_user_id uuid");
      expect(body).toContain("p_expected_user_id <> v_user_id");
      expect(body).toContain("'authentication context changed'");
      expect(body).toContain("errcode = '42501'");
    }
  });

  it("returns the camelCase state needed by each UI operation", () => {
    const exchange = rpcBody("exchange_food");
    const feed = rpcBody("feed_maso_item");

    for (const key of ["growthPoints", "food", "protein", "created"]) {
      expect(exchange).toContain(`'${key}'`);
    }
    for (const key of ["level", "experience", "food", "protein", "created"]) {
      expect(feed).toContain(`'${key}'`);
    }
  });

  it("uses the same prices and experience values as the UI domain", () => {
    const exchange = rpcBody("exchange_food");
    const feed = rpcBody("feed_maso_item");

    expect(exchange).toContain("when 'onigiri' then 5");
    expect(exchange).toContain("when 'protein' then 15");
    expect(feed).toContain("when 'onigiri' then 10");
    expect(feed).toContain("when 'protein' then 30");
  });

  it("redefines workout rewards as growth points without direct food", () => {
    const start = sql.indexOf("create or replace function public.save_workout");
    const end = sql.indexOf("create or replace function public.exchange_food");
    const saveWorkout = sql.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(saveWorkout).toContain(
      "v_growth := floor(v_workout.volume_kg / 100)::integer;",
    );
    expect(saveWorkout).toContain("v_food := 0;");
    expect(saveWorkout).not.toContain("set balance = balance + v_food");
    expect(saveWorkout).toContain(
      "set earned_from_volume = earned_from_volume + v_workout.volume_kg",
    );

    const masoLockIndex = saveWorkout.search(
      /select \* into v_maso\s+from public\.maso_status\s+where user_id = v_user_id\s+for update;/,
    );
    const foodLockIndex = saveWorkout.search(
      /select \* into v_food_state\s+from public\.foods\s+where user_id = v_user_id\s+for update;/,
    );
    expect(masoLockIndex).toBeGreaterThan(-1);
    expect(foodLockIndex).toBeGreaterThan(-1);
    expect(masoLockIndex).toBeLessThan(foodLockIndex);
  });

  it("stores exact results and rejects idempotency-key payload changes", () => {
    expect(sql).toContain("primary key (user_id, request_id)");
    expect(sql).toContain("add column kind text not null default 'onigiri'");
    expect(sql).toContain("add column after_protein_balance integer not null default 0");

    for (const name of ["exchange_food", "feed_maso_item"] as const) {
      const body = rpcBody(name);

      expect(body).toContain("idempotency key reused with different payload");
      expect(body).toContain("'created', false");
      expect(body).toContain("'created', true");
    }
  });

  it("keeps a kind-aware immutable ledger entry for each feed request", () => {
    const feed = rpcBody("feed_maso_item");

    expect(sql).toContain("add column food_kind text");
    expect(sql).toContain("set food_kind = 'onigiri'");
    expect(sql).toContain("and food_kind in ('onigiri', 'protein')");
    expect(feed).toContain("insert into public.reward_ledger");
    expect(feed).toContain("experience_delta, request_id, food_kind");
    expect(feed).toContain("v_added_experience, p_request_id, p_kind");
    expect(feed.indexOf("insert into public.reward_ledger")).toBeGreaterThan(
      feed.indexOf("insert into public.food_logs"),
    );
  });

  it("locks mascot state before food state in both RPCs", () => {
    for (const name of ["exchange_food", "feed_maso_item"] as const) {
      const body = rpcBody(name);
      const masoLock = /select \* into v_maso\s+from public\.maso_status\s+where user_id = v_user_id\s+for update;/;
      const foodLock = /select \* into v_food\s+from public\.foods\s+where user_id = v_user_id\s+for update;/;
      const masoLockIndex = body.search(masoLock);
      const foodLockIndex = body.search(foodLock);

      expect(masoLockIndex).toBeGreaterThan(-1);
      expect(foodLockIndex).toBeGreaterThan(-1);
      expect(masoLockIndex).toBeLessThan(foodLockIndex);
    }
  });

  it("keeps the aggregate food usage counter in sync", () => {
    expect(rpcBody("feed_maso_item")).toContain(
      "used_points = used_points + p_amount",
    );
  });

  it("allows owners to select exchange logs but not write them directly", () => {
    expect(sql).toContain(
      "alter table public.food_exchange_logs enable row level security;",
    );
    expect(sql).toContain("create policy food_exchange_logs_owner_select");
    expect(sql).toContain("using ((select auth.uid()) = user_id)");
    expect(sql).toContain(
      "revoke all on public.food_exchange_logs from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant select on public.food_exchange_logs to authenticated;",
    );
  });
});
