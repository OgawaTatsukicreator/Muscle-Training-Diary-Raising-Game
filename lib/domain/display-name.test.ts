import { describe, expect, it } from "vitest";

import {
  DEFAULT_MASO_NAME,
  displayNameOrDefault,
  displayNameSchema,
  normalizeDisplayName,
  storedNameSchema,
  validateDisplayName,
} from "@/lib/domain/display-name";

// 見た目が空白になる名前。以前は trim() をすり抜けて保存され、表示が空白になった。
const INVISIBLE_ONLY = [
  "\u200b",
  "\u200b\u200c\u200d",
  "\u3164",
  "\u3164\u3164",
  "\u2800",
  "\u2800 \u3000",
  "\ufeff",
  "\u00ad",
  "\u2063",
  "\u115f\u1160",
  "\u0001\u0002",
];

describe("normalizeDisplayName", () => {
  it("trims and collapses any kind of whitespace into one space", () => {
    expect(normalizeDisplayName("  テスト   君 ")).toBe("テスト 君");
    expect(normalizeDisplayName("a\t\nb")).toBe("a b");
    expect(normalizeDisplayName("\u3000名前\u00a0\u00a0です\u3000")).toBe("名前 です");
  });

  it("removes invisible characters inside a name", () => {
    expect(normalizeDisplayName("テ\u200bス\u3164ト")).toBe("テスト");
    expect(normalizeDisplayName("\ufeffAlice")).toBe("Alice");
  });

  it("keeps emoji, symbols and combined characters", () => {
    expect(normalizeDisplayName("マソ君💪")).toBe("マソ君💪");
    expect(normalizeDisplayName("★ヒーロー♪")).toBe("★ヒーロー♪");
    expect(normalizeDisplayName("が")).toBe("が");
  });

  it("composes decomposed kana (NFC)", () => {
    expect(normalizeDisplayName("か\u3099")).toBe("が");
  });
});

describe("validateDisplayName", () => {
  it("accepts ordinary names and returns the normalized form", () => {
    expect(validateDisplayName("  マソ君  ")).toEqual({ ok: true, name: "マソ君" });
    expect(validateDisplayName("Alice")).toEqual({ ok: true, name: "Alice" });
    expect(validateDisplayName("★")).toEqual({ ok: true, name: "★" });
    expect(validateDisplayName("123")).toEqual({ ok: true, name: "123" });
  });

  it("rejects empty and whitespace-only input as empty", () => {
    for (const input of ["", "   ", "\t", "\u3000\u3000"]) {
      const result = validateDisplayName(input);
      expect(result).toMatchObject({ ok: false, problem: "empty" });
    }
  });

  it.each(INVISIBLE_ONLY.map((value) => [JSON.stringify(value), value]))(
    "rejects an invisible-only name %s",
    (_label, value) => {
      const result = validateDisplayName(value);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(["invisible", "empty"]).toContain(result.problem);
      }
    },
  );

  it("rejects a name made only of combining marks", () => {
    expect(validateDisplayName("\u0301\u0301")).toMatchObject({
      ok: false,
      problem: "invisible",
    });
  });

  it("counts characters by code point, not UTF-16 unit", () => {
    expect(validateDisplayName("💪".repeat(30)).ok).toBe(true);
    expect(validateDisplayName("💪".repeat(31))).toMatchObject({
      ok: false,
      problem: "too-long",
    });
    expect(validateDisplayName("あ".repeat(31)).ok).toBe(false);
  });

  it("measures the length after removing invisible characters", () => {
    expect(validateDisplayName(`${"あ".repeat(30)}\u200b\u200b`).ok).toBe(true);
  });

  it("tells the user what is wrong", () => {
    const result = validateDisplayName("\u3164");
    expect(!result.ok && result.message).toContain("見えない");
  });
});

describe("displayNameOrDefault", () => {
  it("returns the normalized stored name", () => {
    expect(displayNameOrDefault("  テスト ", DEFAULT_MASO_NAME)).toBe("テスト");
  });

  it("falls back for blank-looking, empty and missing values", () => {
    for (const value of ["", "\u3164", "\u200b", null, undefined]) {
      expect(displayNameOrDefault(value, DEFAULT_MASO_NAME)).toBe(DEFAULT_MASO_NAME);
    }
  });

  it("truncates an over-long stored name instead of failing", () => {
    expect(displayNameOrDefault("あ".repeat(40), "x")).toBe("あ".repeat(30));
  });
});

describe("schemas", () => {
  it("displayNameSchema normalizes and rejects with a Japanese message", () => {
    expect(displayNameSchema.parse(" a\u200bb ")).toBe("ab");
    const failed = displayNameSchema.safeParse("\u3164");
    expect(failed.success).toBe(false);
    expect(!failed.success && failed.error.issues[0]?.message).toContain("見えない");
  });

  it("storedNameSchema never throws on bad stored data", () => {
    const schema = storedNameSchema(DEFAULT_MASO_NAME);
    expect(schema.parse("\u3164")).toBe(DEFAULT_MASO_NAME);
    expect(schema.parse("テスト")).toBe("テスト");
  });
});
