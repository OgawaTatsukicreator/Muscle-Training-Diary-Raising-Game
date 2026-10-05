import { describe, expect, it } from "vitest";

import {
  calculateVolumeKg,
  fromKilograms,
  toKilograms,
  workoutDraftSchema,
} from "@/lib/domain/workout";
import {
  applyExperience,
  masoImageForLevel,
  masoPhaseForLevel,
  rewardsFromVolume,
} from "@/lib/domain/growth";

describe("workout calculations", () => {
  it("calculates volume in kilograms", () => {
    expect(calculateVolumeKg(50, "kg", 10, 3)).toBe(1500);
  });

  it("converts pounds before calculating volume", () => {
    // Stored kilograms are rounded to three decimal places before aggregation.
    expect(calculateVolumeKg(100, "lb", 10, 3)).toBe(1360.77);
  });

  it("round-trips displayed pounds within one decimal place", () => {
    const kg = toKilograms(135, "lb");
    expect(fromKilograms(kg, "lb")).toBe(135);
  });

  it("returns zero for invalid training values", () => {
    expect(calculateVolumeKg(Number.NaN, "kg", 10, 3)).toBe(0);
    expect(calculateVolumeKg(50, "kg", 0, 3)).toBe(0);
  });

  it("rejects an empty weight converted to NaN", () => {
    const result = workoutDraftSchema.safeParse({
      workoutDate: "2026-07-17",
      exerciseId: "bench-press",
      bodyPart: "chest",
      weight: Number.NaN,
      unit: "kg",
      reps: 10,
      sets: 3,
      memo: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("重量を入力してください");
    }
  });
});

describe("workout draft realism limits", () => {
  const base = {
    workoutDate: "2026-07-17",
    exerciseId: "bench-press",
    bodyPart: "chest" as const,
    weight: 50,
    unit: "kg" as const,
    reps: 10,
    sets: 3,
    memo: "",
  };

  it("accepts a normal workout", () => {
    expect(workoutDraftSchema.safeParse(base).success).toBe(true);
  });

  it.each([
    ["zero weight", { weight: 0 }],
    ["negative weight", { weight: -5 }],
    ["over 500kg", { weight: 501 }],
    ["over 500kg in lb", { weight: 1200, unit: "lb" as const }],
    ["too many reps", { reps: 201 }],
    ["too many sets", { sets: 31 }],
    ["fractional reps", { reps: 10.5 }],
  ])("rejects %s", (_name, override) => {
    expect(workoutDraftSchema.safeParse({ ...base, ...override }).success).toBe(false);
  });
});

describe("growth calculations", () => {
  it("maps mascot levels to the 50 available body phases", () => {
    expect(masoPhaseForLevel(1)).toBe(1);
    expect(masoPhaseForLevel(25)).toBe(25);
    expect(masoPhaseForLevel(50)).toBe(50);
    expect(masoPhaseForLevel(999)).toBe(50);
    expect(masoPhaseForLevel(0)).toBe(1);
    expect(masoPhaseForLevel(Number.NaN)).toBe(1);
  });

  it("builds the matching zero-padded mascot image path", () => {
    expect(masoImageForLevel(1)).toBe("/maso/phases-50/phase-01.svg");
    expect(masoImageForLevel(9)).toBe("/maso/phases-50/phase-09.svg");
    expect(masoImageForLevel(50)).toBe("/maso/phases-50/phase-50.svg");
    expect(masoImageForLevel(51)).toBe("/maso/phases-50/phase-50.svg");
  });

  it("converts volume at the configured boundaries", () => {
    expect(rewardsFromVolume(499)).toEqual({ growthPoints: 4 });
    expect(rewardsFromVolume(500)).toEqual({ growthPoints: 5 });
  });

  it("carries experience across multiple levels", () => {
    expect(applyExperience(1, 90, 220)).toEqual({
      level: 3,
      experience: 10,
      levelsGained: 2,
    });
  });

  it("caps the preview mascot at level 999", () => {
    expect(applyExperience(999, 99_899, 50)).toEqual({
      level: 999,
      experience: 99_900,
      levelsGained: 0,
    });
  });
});
