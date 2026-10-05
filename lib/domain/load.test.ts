import { describe, expect, it } from "vitest";

import { DEFAULT_EXERCISES } from "@/lib/data/default-exercises";
import { EXERCISE_MASTER } from "@/lib/data/exercise-master";
import {
  calculateLoadPerUnitKg,
  calculateVolumeFromLoad,
  conversionLabel,
  customExerciseQuestion,
  defaultsForCustomExercise,
  isUnconvertedBodyPart,
  MAX_UNCONVERTED_MINUTES,
  UNCONVERTED_BODY_PARTS,
} from "@/lib/domain/load";
import { exerciseSchema } from "@/lib/domain/workout";

const BW = 70;

describe("calculateLoadPerUnitKg", () => {
  it("A: uses only the external weight and ignores body weight", () => {
    expect(
      calculateLoadPerUnitKg({
        pattern: "A", bwRatio: 0, isIsometric: false,
        bodyWeightKg: null, weightKg: 60,
      }),
    ).toBe(60);
  });

  it("A: rejects zero weight", () => {
    expect(
      calculateLoadPerUnitKg({
        pattern: "A", bwRatio: 0, isIsometric: false,
        bodyWeightKg: BW, weightKg: 0,
      }),
    ).toBeNull();
  });

  it("B: adds body weight x ratio to the barbell weight", () => {
    expect(
      calculateLoadPerUnitKg({
        pattern: "B", bwRatio: 0.88, isIsometric: false,
        bodyWeightKg: BW, weightKg: 100,
      }),
    ).toBeCloseTo(161.6, 5);
  });

  it("B/C: allows zero added weight when body weight is known", () => {
    expect(
      calculateLoadPerUnitKg({
        pattern: "C", bwRatio: 0.64, isIsometric: false,
        bodyWeightKg: BW, weightKg: 0,
      }),
    ).toBeCloseTo(44.8, 5);
  });

  it("B/C/D: need a body weight", () => {
    for (const pattern of ["B", "C", "D"] as const) {
      expect(
        calculateLoadPerUnitKg({
          pattern, bwRatio: 0.9, isIsometric: false,
          bodyWeightKg: null, weightKg: 0,
        }),
      ).toBeNull();
    }
  });

  it("D: subtracts machine assistance and adds belt weight", () => {
    const base = { pattern: "D" as const, bwRatio: 0.9, isIsometric: false, bodyWeightKg: BW };
    expect(calculateLoadPerUnitKg({ ...base, weightKg: 0, assistKg: 20 })).toBeCloseTo(43, 5);
    expect(calculateLoadPerUnitKg({ ...base, weightKg: 10, assistKg: 0 })).toBeCloseTo(73, 5);
  });

  it("D: rejects assistance that cancels the whole load", () => {
    expect(
      calculateLoadPerUnitKg({
        pattern: "D", bwRatio: 0.9, isIsometric: false,
        bodyWeightKg: BW, weightKg: 0, assistKg: 63,
      }),
    ).toBeNull();
  });

  it("ignores assistance for non-D patterns", () => {
    expect(
      calculateLoadPerUnitKg({
        pattern: "C", bwRatio: 0.5, isIsometric: false,
        bodyWeightKg: BW, weightKg: 0, assistKg: 999,
      }),
    ).toBe(35);
  });

  it("isometric: 10 seconds count as one rep", () => {
    const perSecond = calculateLoadPerUnitKg({
      pattern: "C", bwRatio: 0.65, isIsometric: true,
      bodyWeightKg: BW, weightKg: 0,
    });
    // 60 seconds x 1 set = 6 reps worth of (70 x 0.65) kg
    expect(calculateVolumeFromLoad(perSecond, 60, 1)).toBeCloseTo(6 * 70 * 0.65, 2);
  });

  it("rejects invalid numbers", () => {
    expect(
      calculateLoadPerUnitKg({
        pattern: "A", bwRatio: 0, isIsometric: false,
        bodyWeightKg: null, weightKg: Number.NaN,
      }),
    ).toBeNull();
    expect(
      calculateLoadPerUnitKg({
        pattern: "A", bwRatio: 0, isIsometric: false,
        bodyWeightKg: null, weightKg: -1,
      }),
    ).toBeNull();
  });
});

describe("calculateVolumeFromLoad", () => {
  it("multiplies load by reps and sets", () => {
    expect(calculateVolumeFromLoad(50, 10, 3)).toBe(1500);
  });

  it("returns zero for a missing load or invalid counts", () => {
    expect(calculateVolumeFromLoad(null, 10, 3)).toBe(0);
    expect(calculateVolumeFromLoad(50, 0, 3)).toBe(0);
    expect(calculateVolumeFromLoad(50, 10, 0)).toBe(0);
  });
});

describe("custom exercise defaults", () => {
  it("treats legs as bodyweight-plus-weight only when the user says so", () => {
    expect(defaultsForCustomExercise("legs", { usesBodyweight: true })).toMatchObject({
      calculationPattern: "B", bwRatio: 0.74,
    });
    expect(defaultsForCustomExercise("legs", { usesBodyweight: false })).toMatchObject({
      calculationPattern: "A", bwRatio: 0,
    });
    expect(defaultsForCustomExercise("legs").calculationPattern).toBe("A");
  });

  it("treats abs as bodyweight only, optionally isometric", () => {
    expect(defaultsForCustomExercise("abs")).toEqual({
      calculationPattern: "C", bwRatio: 0.5, isIsometric: false,
    });
    expect(defaultsForCustomExercise("abs", { isIsometric: true }).isIsometric).toBe(true);
  });

  it("treats every other body part as external weight", () => {
    for (const part of ["chest", "back", "shoulders", "arms", "cardio", "other"] as const) {
      expect(defaultsForCustomExercise(part, { usesBodyweight: true, isIsometric: true })).toEqual({
        calculationPattern: "A", bwRatio: 0, isIsometric: false,
      });
    }
  });

  it("only asks a question for legs and abs", () => {
    expect(customExerciseQuestion("legs")).toBe("usesBodyweight");
    expect(customExerciseQuestion("abs")).toBe("isIsometric");
    expect(customExerciseQuestion("chest")).toBeNull();
  });
});

describe("exercise master", () => {
  it("contains the 58 reference exercises plus 3 legacy ones with unique keys and names", () => {
    expect(EXERCISE_MASTER).toHaveLength(61);
    expect(new Set(EXERCISE_MASTER.map((item) => item.key)).size).toBe(61);
    expect(new Set(EXERCISE_MASTER.map((item) => `${item.bodyPart}:${item.name}`)).size).toBe(61);
  });

  it("keeps the ratio consistent with the pattern", () => {
    for (const item of EXERCISE_MASTER) {
      if (item.calculationPattern === "A") {
        expect(item.bwRatio).toBe(0);
      } else {
        expect(item.bwRatio).toBeGreaterThan(0);
        expect(item.bwRatio).toBeLessThanOrEqual(1);
      }
    }
  });

  it("marks only plank variants as isometric", () => {
    expect(
      EXERCISE_MASTER.filter((item) => item.isIsometric).map((item) => item.name),
    ).toEqual(["プランク", "サイドプランク"]);
  });

  it("keeps the legacy default exercise ids stable", () => {
    const ids = new Set(DEFAULT_EXERCISES.map((item) => item.id));
    for (const id of [
      "default-bench-press", "default-push-up", "default-lat-pulldown", "default-deadlift",
      "default-squat", "default-leg-press", "default-shoulder-press", "default-side-raise",
      "default-arm-curl", "default-triceps-extension", "default-crunch", "default-plank",
      "default-walking", "default-running",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("produces exercises that satisfy the exercise schema", () => {
    for (const item of DEFAULT_EXERCISES) {
      expect(exerciseSchema.safeParse(item).success).toBe(true);
    }
  });

  it("fills in pattern A for exercises saved before this feature", () => {
    const parsed = exerciseSchema.parse({
      id: "x", name: "旧種目", bodyPart: "chest", isDefault: false,
    });
    expect(parsed).toMatchObject({ calculationPattern: "A", bwRatio: 0, isIsometric: false });
  });
});

describe("unconverted body parts", () => {
  it("treats cardio, and only cardio, as unconverted", () => {
    expect([...UNCONVERTED_BODY_PARTS]).toEqual(["cardio"]);
    expect(isUnconvertedBodyPart("cardio")).toBe(true);
    for (const part of ["chest", "back", "legs", "shoulders", "arms", "abs", "other"] as const) {
      expect(isUnconvertedBodyPart(part), part).toBe(false);
    }
  });

  it("labels the conversion shown in the exercise list", () => {
    expect(conversionLabel({ bodyPart: "cardio", calculationPattern: "A" })).toBe("未換算");
    expect(conversionLabel({ bodyPart: "chest", calculationPattern: "A" })).toBe("ウエイト");
    expect(conversionLabel({ bodyPart: "abs", calculationPattern: "C" })).toBe("自重");
  });

  it("allows up to ten hours", () => {
    expect(MAX_UNCONVERTED_MINUTES).toBe(600);
  });

  it("puts every cardio exercise of the master in that part", () => {
    const cardio = EXERCISE_MASTER.filter((item) => isUnconvertedBodyPart(item.bodyPart));
    expect(cardio.map((item) => item.name).sort()).toEqual(["ウォーキング", "ランニング"]);
  });
});
