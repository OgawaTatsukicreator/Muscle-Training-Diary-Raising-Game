import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./0001_initial.sql", import.meta.url), "utf8");

describe("initial Supabase migration contract", () => {
  it("enables RLS for every user-data table", () => {
    const tables = [
      "profiles",
      "user_settings",
      "exercises",
      "workout_logs",
      "maso_status",
      "foods",
      "reward_ledger",
      "food_logs",
      "growth_logs",
    ];

    for (const table of tables) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
  });

  it("rejects a missing unit instead of treating it as kilograms", () => {
    expect(sql).toContain("or p_unit is null or p_unit not in ('kg', 'lb')");
  });

  it("locks mascot state before food state in both atomic RPCs", () => {
    const saveWorkout = sql.slice(
      sql.indexOf("create or replace function public.save_workout"),
      sql.indexOf("create or replace function public.feed_maso"),
    );
    const feedMaso = sql.slice(
      sql.indexOf("create or replace function public.feed_maso"),
      sql.indexOf("create or replace function public.rename_maso"),
    );

    expect(saveWorkout.indexOf("select * into v_maso")).toBeLessThan(
      saveWorkout.indexOf("select * into v_food_state"),
    );
    expect(feedMaso.indexOf("select * into v_maso")).toBeLessThan(
      feedMaso.indexOf("select * into v_food\n"),
    );
  });

  it("removes public access before granting authenticated capabilities", () => {
    expect(sql).toContain("from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.save_workout");
    expect(sql).toContain("grant execute on function public.feed_maso");
    expect(sql).toContain("grant execute on function public.rename_maso");
  });
});
