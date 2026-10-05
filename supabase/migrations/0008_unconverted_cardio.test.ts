import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MAX_UNCONVERTED_MINUTES, UNCONVERTED_BODY_PARTS } from "@/lib/domain/load";

const sql = readFileSync(
  new URL("./0008_unconverted_cardio.sql", import.meta.url),
  "utf8",
);

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const next = sql.indexOf("create or replace function public.", start + 1);

  return sql.slice(start, next === -1 ? sql.length : next);
}

const FUNCTIONS = ["compute_workout_values", "save_workout"] as const;

describe("unconverted cardio migration contract", () => {
  it("treats exactly the parts of UNCONVERTED_BODY_PARTS as unconverted", () => {
    const parts = new Set(
      [...sql.matchAll(/body_part (?:=|<>) '([a-z]+)'/g)].map(([, part]) => part),
    );

    expect([...parts].sort()).toEqual([...UNCONVERTED_BODY_PARTS].sort());
  });

  it("applies the rule in every function that validates a workout", () => {
    for (const name of FUNCTIONS) {
      const body = functionBody(name);

      for (const part of UNCONVERTED_BODY_PARTS) {
        // the amount is the time only: weight and assist are dropped
        expect(body, `${name} zeroes the weight and assist`).toMatch(
          new RegExp(`body_part = '${part}' then\\s+\\w+ := 0;\\s+\\w+ := 0;`),
        );
        // the load is 0 instead of being rejected by the load > 0 rule
        expect(body, `${name} gives cardio a load of 0`).toMatch(
          new RegExp(`body_part = '${part}' then\\s+\\w+ := \\w+;\\s+v_load := 0;`),
        );
        expect(body, `${name} keeps the load check for the rest`).toContain(
          `and v_exercise.body_part <> '${part}' then`,
        );
      }
    }
  });

  it("allows as many minutes as the client", () => {
    for (const name of FUNCTIONS) {
      expect(functionBody(name)).toContain(
        `when v_exercise.is_isometric or v_exercise.body_part = 'cardio' then ${MAX_UNCONVERTED_MINUTES}`,
      );
    }
  });

  it("keeps the other limits of the workout validation", () => {
    for (const name of FUNCTIONS) {
      const body = functionBody(name);

      expect(body).toContain("or p_reps is null or p_reps < 1");
      expect(body).toContain("p_workout_date > (now() at time zone 'Asia/Tokyo')::date");
      expect(body).toContain("else 200");
      expect(body).toContain("> 50000");
    }
  });

  it("keeps the signatures and the access rules of the replaced functions", () => {
    expect(sql).not.toMatch(/drop function/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
    expect(sql).toMatch(/revoke all on function public\.compute_workout_values\(/);
    expect(functionBody("save_workout")).toContain("p_body_weight_kg numeric default null");
    expect(functionBody("save_workout")).toContain("p_assist numeric default 0");
    expect(functionBody("compute_workout_values")).toContain("language plpgsql");
    expect(functionBody("compute_workout_values")).toContain("stable");
  });

  it("does not change tables or rewrite saved records", () => {
    expect(sql).not.toMatch(/\b(alter|create|drop) table\b/i);
    expect(sql).not.toMatch(/\bupdate public\.workout_logs\b/i);
  });
});
