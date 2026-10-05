import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EXERCISE_MASTER } from "@/lib/data/exercise-master";
import {
  CUSTOM_BW_RATIO,
  ISOMETRIC_SECONDS_PER_REP,
  MAX_BODY_WEIGHT_KG,
  MAX_ISOMETRIC_SECONDS,
  MAX_VOLUME_KG,
  MIN_BODY_WEIGHT_KG,
} from "@/lib/domain/load";
import { MAX_REPS, MAX_SETS, MAX_WEIGHT_KG } from "@/lib/domain/workout";

const sql = readFileSync(
  new URL("./0003_load_calculation.sql", import.meta.url),
  "utf8",
);

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const next = sql.indexOf("create or replace function public.", start + 1);

  return sql.slice(start, next === -1 ? sql.length : next);
}

describe("load calculation migration contract", () => {
  it("keeps the SQL exercise master identical to lib/data/exercise-master.ts", () => {
    const block = functionBody("exercise_master");
    const rows = [
      ...block.matchAll(
        /\('([^']+)', '([^']+)', '([^']+)', '([A-D])', ([0-9.]+), (true|false)\)/g,
      ),
    ].map(([, key, name, bodyPart, pattern, ratio, isometric]) => ({
      key,
      name,
      bodyPart,
      calculationPattern: pattern,
      bwRatio: Number(ratio),
      isIsometric: isometric === "true",
    }));

    expect(rows).toEqual(
      EXERCISE_MASTER.map((item) => ({
        key: item.key,
        name: item.name,
        bodyPart: item.bodyPart,
        calculationPattern: item.calculationPattern,
        bwRatio: item.bwRatio,
        isIsometric: item.isIsometric,
      })),
    );
  });

  it("mirrors the TypeScript limits in save_workout", () => {
    const body = functionBody("save_workout");

    expect(body).toContain(`p_sets not between 1 and ${MAX_SETS}`);
    expect(body).toContain(`v_weight_kg > ${MAX_WEIGHT_KG}`);
    expect(body).toContain(`then ${MAX_ISOMETRIC_SECONDS} else ${MAX_REPS} end`);
    expect(body).toContain(`v_volume > ${MAX_VOLUME_KG}`);
    expect(body).toContain(
      `p_body_weight_kg not between ${MIN_BODY_WEIGHT_KG} and ${MAX_BODY_WEIGHT_KG}`,
    );
    expect(body).toContain(`v_load / ${ISOMETRIC_SECONDS_PER_REP}`);
    expect(sql).toContain(
      `weight_kg numeric(6, 3) not null check (weight_kg between ${MIN_BODY_WEIGHT_KG} and ${MAX_BODY_WEIGHT_KG})`,
    );
  });

  it("derives the custom exercise pattern from the body part on the server", () => {
    const body = functionBody("add_exercise");

    expect(body).toContain(`v_ratio := ${CUSTOM_BW_RATIO.legs};`);
    expect(body).toContain(`v_ratio := ${CUSTOM_BW_RATIO.abs};`);
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = ''");
  });

  it("stops clients from inserting exercises or editing patterns directly", () => {
    expect(sql).toContain("revoke insert, update on public.exercises from authenticated;");
    expect(sql).toContain("grant update (name) on public.exercises to authenticated;");
  });

  it("recomputes volume from the stored per-unit load without rewriting history", () => {
    expect(sql).toContain("update public.workout_logs set load_per_unit_kg = weight_kg;");
    expect(sql).toContain("round((load_per_unit_kg * reps * sets)::numeric, 3)");
  });

  it("locks mascot state before food state in save_workout", () => {
    const body = functionBody("save_workout");

    expect(body.indexOf("select * into v_maso")).toBeLessThan(
      body.indexOf("select * into v_food_state"),
    );
  });

  it("enables RLS and exposes only select on body weights", () => {
    expect(sql).toContain("alter table public.body_weight_logs enable row level security;");
    expect(sql).toContain("grant select on public.body_weight_logs to authenticated;");
  });

  it("retires the old save_workout and exposes the new RPCs to authenticated only", () => {
    expect(sql).toContain(
      "drop function public.save_workout(uuid, date, numeric, text, integer, integer, text, uuid);",
    );

    for (const signature of [
      "public.add_exercise(text, text, boolean, boolean)",
      "public.save_workout(\n  uuid, date, numeric, text, integer, integer, text, uuid, numeric, numeric\n)",
      "public.save_body_weight(date, numeric)",
    ]) {
      expect(sql).toContain(`revoke all on function ${signature}`);
      expect(sql).toContain(`grant execute on function ${signature}`);
    }
  });
});
