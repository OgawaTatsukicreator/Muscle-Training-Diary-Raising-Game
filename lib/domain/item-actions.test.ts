import { describe, expect, it } from "vitest";

import {
  clampItemActionAmount,
  isValidItemActionAmount,
  maxExchangeAmount,
  workoutRewardAdjustment,
} from "@/lib/domain/growth";

describe("item action quantities", () => {
  it("only allows whole items covered by the selected item's price", () => {
    expect(maxExchangeAmount(4, "onigiri")).toBe(0);
    expect(maxExchangeAmount(5, "onigiri")).toBe(1);
    expect(maxExchangeAmount(29, "onigiri")).toBe(5);
    expect(maxExchangeAmount(14, "protein")).toBe(0);
    expect(maxExchangeAmount(15, "protein")).toBe(1);
    expect(maxExchangeAmount(29, "protein")).toBe(1);
    expect(maxExchangeAmount(30, "protein")).toBe(2);
  });

  it("caps a single exchange at the RPC limit even with surplus points", () => {
    expect(maxExchangeAmount(4_995, "onigiri")).toBe(999);
    expect(maxExchangeAmount(5_000, "onigiri")).toBe(1_000);
    expect(maxExchangeAmount(5_005, "onigiri")).toBe(1_000);
    expect(maxExchangeAmount(15_015, "protein")).toBe(1_000);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not offer an exchange for an invalid or empty balance: %s",
    (balance) => expect(maxExchangeAmount(balance, "onigiri")).toBe(0),
  );

  it("constrains direct entry to whole items within the current limit", () => {
    expect(clampItemActionAmount(3.9, 8)).toBe(3);
    expect(clampItemActionAmount(9, 8)).toBe(8);
    expect(clampItemActionAmount(-3, 8)).toBe(1);
    expect(clampItemActionAmount(0, 8)).toBe(1);
    expect(clampItemActionAmount(Number.NaN, 8)).toBe(1);
    expect(clampItemActionAmount(Number.POSITIVE_INFINITY, 8)).toBe(1);
    expect(clampItemActionAmount(2_000, 2_000)).toBe(1_000);
    expect(clampItemActionAmount(8, 0)).toBe(1);
  });

  it.each([0, -1, 1.5, 1_001, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid quantity before an inventory mutation: %s",
    (amount) => expect(isValidItemActionAmount(amount)).toBe(false),
  );

  it("accepts both ends of the supported quantity range", () => {
    expect(isValidItemActionAmount(1)).toBe(true);
    expect(isValidItemActionAmount(1_000)).toBe(true);
  });
});

describe("workout reward adjustment", () => {
  it("grants the difference when a record grows", () => {
    expect(workoutRewardAdjustment({ granted: 50, volumeKg: 6000, balance: 50 })).toEqual({
      applied: 10,
      granted: 60,
      target: 60,
    });
  });

  it("takes points back when a record shrinks", () => {
    expect(workoutRewardAdjustment({ granted: 60, volumeKg: 2000, balance: 60 })).toEqual({
      applied: -40,
      granted: 20,
      target: 20,
    });
  });

  it("never takes back more than the player still holds", () => {
    expect(workoutRewardAdjustment({ granted: 20, volumeKg: 1000, balance: 0 })).toEqual({
      applied: 0,
      granted: 20,
      target: 10,
    });
    expect(workoutRewardAdjustment({ granted: 50, volumeKg: 0, balance: 30 })).toEqual({
      applied: -30,
      granted: 20,
      target: 0,
    });
  });

  it("cannot mint points by editing down and back up", () => {
    let granted = 50;
    let balance = 0;

    // 50 points granted and all spent. Edit down to 20 points worth, then back to 50.
    const down = workoutRewardAdjustment({ granted, volumeKg: 2000, balance });
    granted = down.granted;
    balance += down.applied;
    const up = workoutRewardAdjustment({ granted, volumeKg: 5000, balance });
    granted = up.granted;
    balance += up.applied;

    expect(balance).toBe(0);
    expect(granted).toBe(50);
  });

  it("treats a deleted record as zero volume", () => {
    expect(workoutRewardAdjustment({ granted: 13, volumeKg: 0, balance: 100 }).applied).toBe(-13);
  });

  it("ignores invalid volumes and negative balances safely", () => {
    expect(workoutRewardAdjustment({ granted: 5, volumeKg: Number.NaN, balance: 10 }).applied).toBe(-5);
    expect(workoutRewardAdjustment({ granted: 5, volumeKg: 0, balance: -3 }).applied).toBe(0);
  });
});
