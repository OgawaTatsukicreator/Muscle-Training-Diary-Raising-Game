import { describe, expect, it } from "vitest";

import { EXERCISE_MASTER } from "@/lib/data/exercise-master";
import {
  bodyWeightEntrySchema,
  latestBodyWeightKg,
  upsertBodyWeight,
} from "@/lib/domain/body-weight";
import {
  describeRecordLoad,
  evaluateWorkoutDraft,
  isUnconvertedRecord,
} from "@/lib/domain/workout-load";
import { workoutDraftSchema, type WorkoutDraft } from "@/lib/domain/workout";

function exercise(key: string) {
  const found = EXERCISE_MASTER.find((item) => item.key === key);
  if (!found) throw new Error(`unknown exercise ${key}`);
  return found;
}

function draft(overrides: Partial<WorkoutDraft> = {}): WorkoutDraft {
  return workoutDraftSchema.parse({
    workoutDate: "2026-01-02",
    exerciseId: "x",
    bodyPart: "chest",
    weight: 0,
    unit: "kg",
    reps: 10,
    sets: 3,
    memo: "",
    ...overrides,
  });
}

describe("evaluateWorkoutDraft", () => {
  // The same cases are executed against PostgreSQL in
  // supabase/tests/account-isolation.mjs; keep the expected numbers identical.
  it.each([
    ["default-squat", { weight: 100, reps: 5, sets: 3, bodyWeightKg: 70 }, 161.6, 2424],
    ["default-push-up", { weight: 0, reps: 20, sets: 3, bodyWeightKg: 70 }, 44.8, 2688],
    ["pull-up", { weight: 0, reps: 8, sets: 3, bodyWeightKg: 70, assist: 20 }, 43, 1032],
    ["dips", { weight: 10, reps: 5, sets: 2, bodyWeightKg: 70 }, 73.7, 737],
    ["default-plank", { weight: 0, reps: 60, sets: 2, bodyWeightKg: 70 }, 4.55, 546],
    ["default-bench-press", { weight: 135, unit: "lb" as const, reps: 10, sets: 3 }, 61.235, 1837.05],
  ])("%s matches the SQL fixtures", (key, input, load, volume) => {
    const result = evaluateWorkoutDraft(draft(input), exercise(key), null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.loadPerUnitKg).toBeCloseTo(load, 4);
      expect(result.value.volumeKg).toBeCloseTo(volume, 3);
    }
  });

  it("uses the fallback body weight when the draft has none", () => {
    const result = evaluateWorkoutDraft(
      draft({ reps: 5, sets: 1 }),
      exercise("pull-up"),
      69,
    );
    expect(result.ok && result.value.loadPerUnitKg).toBeCloseTo(62.1, 4);
    expect(result.ok && result.value.bodyWeightKg).toBe(69);
  });

  it("prefers the body weight typed into the draft over the fallback", () => {
    const result = evaluateWorkoutDraft(
      draft({ bodyWeightKg: 72, weight: 50, reps: 5, sets: 1 }),
      exercise("default-squat"),
      60,
    );
    expect(result.ok && result.value.loadPerUnitKg).toBeCloseTo(113.36, 4);
  });

  it("keeps a typed body weight on weight-only exercises without using it", () => {
    const result = evaluateWorkoutDraft(
      draft({ weight: 60, bodyWeightKg: 71.25 }),
      exercise("default-bench-press"),
      null,
    );
    expect(result.ok && result.value.loadPerUnitKg).toBe(60);
    expect(result.ok && result.value.bodyWeightKg).toBe(71.25);
  });

  it("asks for a body weight on body-weight exercises", () => {
    const result = evaluateWorkoutDraft(draft(), exercise("default-push-up"), null);
    expect(result).toEqual({
      ok: false,
      fieldErrors: { bodyWeightKg: "体重を入力してください" },
    });
  });

  it("does not need a body weight for weight-only exercises", () => {
    const result = evaluateWorkoutDraft(draft({ weight: 50 }), exercise("default-bench-press"), null);
    expect(result.ok).toBe(true);
  });

  it("rejects zero weight on weight-only exercises", () => {
    const result = evaluateWorkoutDraft(draft({ weight: 0 }), exercise("default-bench-press"), null);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.fieldErrors.weight).toBeDefined();
  });

  it("rejects assistance that cancels the whole load", () => {
    const result = evaluateWorkoutDraft(
      draft({ bodyWeightKg: 70, assist: 63, reps: 5, sets: 1 }),
      exercise("pull-up"),
      null,
    );
    expect(!result.ok && result.fieldErrors.assist).toBeDefined();
  });

  it("ignores assistance on exercises other than the hanging pattern", () => {
    const result = evaluateWorkoutDraft(
      draft({ bodyWeightKg: 70, assist: 400 }),
      exercise("default-push-up"),
      null,
    );
    expect(result.ok && result.value.loadPerUnitKg).toBeCloseTo(44.8, 4);
  });

  it("limits repetitions to 200 except for timed exercises", () => {
    const tooMany = evaluateWorkoutDraft(draft({ weight: 20, reps: 201 }), exercise("default-bench-press"), null);
    expect(!tooMany.ok && tooMany.fieldErrors.reps).toBeDefined();

    const plank = evaluateWorkoutDraft(draft({ reps: 300, sets: 1, bodyWeightKg: 70 }), exercise("default-plank"), null);
    expect(plank.ok).toBe(true);
  });

  it("rejects a record whose volume is over 50,000 kg", () => {
    const result = evaluateWorkoutDraft(
      draft({ weight: 200, reps: 200, sets: 2 }),
      exercise("default-bench-press"),
      null,
    );
    expect(!result.ok && result.fieldErrors.volume).toBeDefined();
  });
});

describe("unconverted exercises (cardio)", () => {
  // Executed against PostgreSQL in supabase/tests/account-isolation.mjs.
  it("records time only: no load, no volume, weight ignored, one set", () => {
    const result = evaluateWorkoutDraft(
      draft({ bodyPart: "cardio", weight: 80, assist: 30, reps: 45, sets: 4 }),
      exercise("default-running"),
      null,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        weightKg: 0,
        assistKg: 0,
        bodyWeightKg: null,
        loadPerUnitKg: 0,
        volumeKg: 0,
        reps: 45,
        sets: 1,
      },
    });
  });

  it("needs neither a weight nor a body weight, but keeps a typed body weight", () => {
    const plain = evaluateWorkoutDraft(draft({ weight: 0 }), exercise("default-walking"), null);
    expect(plain.ok).toBe(true);

    const typed = evaluateWorkoutDraft(
      draft({ weight: 0, bodyWeightKg: 68.5 }),
      exercise("default-walking"),
      null,
    );
    expect(typed.ok && typed.value.bodyWeightKg).toBe(68.5);
  });

  it("is decided by the exercise's body part, not by its pattern", () => {
    const result = evaluateWorkoutDraft(
      draft({ weight: 0 }),
      { bodyPart: "cardio", calculationPattern: "B", bwRatio: 0.88, isIsometric: false },
      null,
    );
    expect(result.ok && result.value.volumeKg).toBe(0);
  });

  it("does not change how other exercises are evaluated", () => {
    const result = evaluateWorkoutDraft(draft({ weight: 0 }), exercise("default-bench-press"), null);
    expect(result.ok).toBe(false);
  });

  it("recognises saved cardio records and describes them by time", () => {
    const record = {
      bodyPart: "cardio" as const,
      weightKg: 0,
      assistKg: 0,
      reps: 30,
      sets: 1,
      loadPerUnitKg: 0,
    };
    expect(isUnconvertedRecord(record)).toBe(true);
    expect(describeRecordLoad(record, exercise("default-running"), "kg")).toBe("30分 · 未換算");
  });

  it("keeps cardio records saved with a weight before this rule as ordinary records", () => {
    const legacy = {
      bodyPart: "cardio" as const,
      weightKg: 5,
      assistKg: 0,
      reps: 30,
      sets: 3,
      loadPerUnitKg: 5,
    };
    expect(isUnconvertedRecord(legacy)).toBe(false);
    expect(describeRecordLoad(legacy, exercise("default-running"), "kg")).toBe("5 kg × 30回 × 3セット");
    expect(isUnconvertedRecord({ ...legacy, bodyPart: "chest", loadPerUnitKg: 0 })).toBe(false);
  });
});

describe("body weight helpers", () => {
  const entries = [
    { date: "2026-01-01", weightKg: 69 },
    { date: "2026-01-05", weightKg: 70.5 },
  ];

  it("finds the latest weight on or before the day", () => {
    expect(latestBodyWeightKg(entries, "2025-12-31")).toBeNull();
    expect(latestBodyWeightKg(entries, "2026-01-01")).toBe(69);
    expect(latestBodyWeightKg(entries, "2026-01-04")).toBe(69);
    expect(latestBodyWeightKg(entries, "2026-01-05")).toBe(70.5);
    expect(latestBodyWeightKg([], "2026-01-05")).toBeNull();
  });

  it("keeps one entry per day and sorts by date", () => {
    const next = upsertBodyWeight(entries, { date: "2026-01-01", weightKg: 68 });
    expect(next).toEqual([
      { date: "2026-01-01", weightKg: 68 },
      { date: "2026-01-05", weightKg: 70.5 },
    ]);
  });

  it("validates the entry range", () => {
    expect(bodyWeightEntrySchema.safeParse({ date: "2026-01-01", weightKg: 19 }).success).toBe(false);
    expect(bodyWeightEntrySchema.safeParse({ date: "2026-01-01", weightKg: 60 }).success).toBe(true);
  });
});
