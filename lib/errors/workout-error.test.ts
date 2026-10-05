import { describe, expect, it } from "vitest";

import { workoutFailure } from "@/lib/errors/workout-error";

describe("workoutFailure", () => {
  it("points a missing body weight at the body weight field", () => {
    const failure = workoutFailure({ code: "22023", message: "body weight required" });

    expect(failure.fieldErrors).toEqual({ bodyWeightKg: "体重を入力してください" });
    expect(failure.message).toContain("体重");
  });

  it("points an oversized record at the volume", () => {
    const failure = workoutFailure({ code: "22023", message: "workout volume too large" });

    expect(failure.fieldErrors?.volume).toContain("大きすぎます");
  });

  it("explains a record that no longer exists", () => {
    const failure = workoutFailure({ code: "P0002", message: "workout not found" });

    expect(failure.message).toContain("見つかりません");
    expect(failure.fieldErrors).toBeUndefined();
  });

  it("explains a replay that does not match the original request", () => {
    const failure = workoutFailure({
      code: "22023",
      message: "idempotency key reused with different payload",
    });

    expect(failure.message).toContain("再読み込み");
  });

  it("falls back to a generic validation message for other rejected values", () => {
    expect(workoutFailure({ code: "22023", message: "invalid workout values" }).message).toBe(
      "入力内容を確認してください。",
    );
  });

  it("separates connection and login problems from input problems", () => {
    expect(workoutFailure({ message: "TypeError: Failed to fetch" }).message).toContain("通信");
    expect(workoutFailure({ code: "28000", message: "authentication required" }).message).toContain("ログイン");
  });

  it("never throws on odd error values", () => {
    for (const value of [null, undefined, "boom", 42, {}]) {
      expect(workoutFailure(value).message.length).toBeGreaterThan(0);
    }
  });
});
