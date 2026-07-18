import { describe, expect, it } from "vitest";

import {
  calculateVolumeKg,
  fromKilograms,
  toKilograms,
  workoutDraftSchema,
} from "@/lib/domain/workout";
import {
  applyExperience,
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

describe("growth calculations", () => {
  it("converts volume at the configured boundaries", () => {
    expect(rewardsFromVolume(499)).toEqual({ growthPoints: 4, food: 0 });
    expect(rewardsFromVolume(500)).toEqual({ growthPoints: 5, food: 1 });
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
