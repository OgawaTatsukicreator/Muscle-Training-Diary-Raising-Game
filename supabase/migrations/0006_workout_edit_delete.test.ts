import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  MAX_BODY_WEIGHT_KG,
  MAX_ISOMETRIC_SECONDS,
  MAX_VOLUME_KG,
  MIN_BODY_WEIGHT_KG,
} from "@/lib/domain/load";
import { MAX_REPS, MAX_SETS, MAX_WEIGHT_KG } from "@/lib/domain/workout";

const sql = readFileSync(
  new URL("./0006_workout_edit_delete.sql", import.meta.url),
  "utf8",
);

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const next = sql.indexOf("create or replace function public.", start + 1);

  return sql.slice(start, next === -1 ? sql.length : next);
}

describe("workout edit/delete migration contract", () => {
  it("applies the same input limits as save_workout and the client", () => {
    const body = functionBody("compute_workout_values");

    expect(body).toContain(`p_sets not between 1 and ${MAX_SETS}`);
    expect(body).toContain(`then ${MAX_ISOMETRIC_SECONDS} else ${MAX_REPS} end`);
    expect(body).toContain(`o_weight_kg > ${MAX_WEIGHT_KG}`);
    expect(body).toContain(`o_volume_kg > ${MAX_VOLUME_KG}`);
    expect(body).toContain(
      `p_body_weight_kg not between ${MIN_BODY_WEIGHT_KG} and ${MAX_BODY_WEIGHT_KG}`,
    );
  });

  it("keeps the helper internal", () => {
    expect(sql).toMatch(
      /revoke all on function public\.compute_workout_values\([\s\S]*?\) from public, anon, authenticated;/,
    );
    expect(sql).not.toMatch(/grant execute on function public\.compute_workout_values/);
  });

  it("locks mascot state before food state before the workout row", () => {
    for (const name of ["update_workout", "delete_workout"]) {
      const body = functionBody(name);
      const maso = body.indexOf("select * into v_maso");
      const food = body.indexOf("select * into v_food");
      const workout = body.indexOf("select * into v_workout");

      expect(maso, name).toBeGreaterThan(-1);
      expect(maso, name).toBeLessThan(food);
      expect(food, name).toBeLessThan(workout);
    }
  });

  it("clamps the points taken back so the balance never goes negative", () => {
    expect(functionBody("update_workout")).toContain(
      "greatest(v_target - v_granted, -v_maso.growth_points)",
    );
    expect(functionBody("delete_workout")).toContain(
      "greatest(-v_granted, -v_maso.growth_points)",
    );
  });

  it("starts each adjustment from the ledger sum, not from the volume formula", () => {
    for (const name of ["update_workout", "delete_workout"]) {
      expect(functionBody(name)).toContain("sum(growth_points_delta)");
    }
  });

  it("only soft-deletes so the ledger keeps its foreign key", () => {
    const body = functionBody("delete_workout");

    expect(body).toContain("set deleted_at = now()");
    expect(body).not.toMatch(/delete from public\.workout_logs/);
  });

  it("does not let callers pick the account", () => {
    for (const name of ["update_workout", "delete_workout"]) {
      const body = functionBody(name);

      expect(body).toContain("v_user_id uuid := auth.uid()");
      expect(body).not.toContain("p_user_id");
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = ''");
    }
  });

  it("exposes the two RPCs to signed-in users only", () => {
    expect(sql).toContain("grant execute on function public.delete_workout(uuid, uuid) to authenticated;");
    expect(sql).toMatch(/grant execute on function public\.update_workout\([\s\S]*?\) to authenticated;/);
    expect(sql).toContain("revoke all on function public.delete_workout(uuid, uuid)");
  });
});
