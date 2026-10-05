import { describe, expect, it } from "vitest";

import { foodFailure } from "@/lib/errors/food-error";

describe("foodFailure", () => {
  it("refreshes the screen when another session already spent the points", () => {
    const failure = foodFailure({ code: "22023", message: "insufficient growth points" }, "exchange");

    expect(failure.message).toContain("育成ポイントが足りません");
    expect(failure.shouldRefresh).toBe(true);
  });

  it("refreshes the screen when the food is already gone", () => {
    const failure = foodFailure({ code: "22023", message: "insufficient food" }, "feed");

    expect(failure.message).toContain("エサが足りません");
    expect(failure.shouldRefresh).toBe(true);
  });

  it("explains the inventory limit without refreshing", () => {
    const failure = foodFailure({ code: "22003", message: "inventory limit reached" }, "exchange");

    expect(failure.message).toContain("所持できません");
    expect(failure.shouldRefresh).toBe(false);
  });

  it("asks for a reload when a request id is reused for something else", () => {
    const failure = foodFailure(
      { code: "22023", message: "idempotency key reused with different payload" },
      "feed",
    );

    expect(failure.message).toContain("再読み込み");
    expect(failure.shouldRefresh).toBe(true);
  });

  it("separates connection and login problems", () => {
    expect(foodFailure({ message: "TypeError: Failed to fetch" }, "feed").message).toContain("通信");
    expect(foodFailure({ code: "28000", message: "authentication required" }, "exchange").message).toContain("ログイン");
    expect(foodFailure({ code: "PGRST202", message: "Could not find the function" }, "exchange").message).toContain("更新");
  });

  it("names the action in the generic message", () => {
    expect(foodFailure({ code: "XYZ" }, "exchange").message).toContain("交換");
    expect(foodFailure({ code: "XYZ" }, "feed").message).toContain("エサやり");
  });

  it("never throws on odd error values", () => {
    for (const value of [null, undefined, "boom", 7, {}]) {
      expect(foodFailure(value, "feed").message.length).toBeGreaterThan(0);
    }
  });
});
