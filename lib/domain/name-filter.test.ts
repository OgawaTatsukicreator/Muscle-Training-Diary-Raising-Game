import { describe, expect, it } from "vitest";

import terms from "@/lib/domain/name-filter-terms.json";
import {
  CONTAINS_TERMS,
  isNameAllowed,
  TOKEN_TERMS,
  toSkeleton,
} from "@/lib/domain/name-filter";
import {
  displayNameFieldSchema,
  displayNameOrDefault,
  validateDisplayName,
} from "@/lib/domain/display-name";

describe("toSkeleton", () => {
  it("folds width, case and kana", () => {
    expect(toSkeleton("ＦＵＣＫ")).toBe("fuck");
    expect(toSkeleton("ﾁﾝｺ")).toBe("ちんこ");
    expect(toSkeleton("チンコ")).toBe("ちんこ");
    expect(toSkeleton("Ｓｅｘ")).toBe("sex");
  });

  it("drops spaces, symbols and emoji so they cannot split a word", () => {
    expect(toSkeleton("f.u-c k")).toBe("fuck");
    expect(toSkeleton("死 ✕ ね")).toBe("死ね");
    expect(toSkeleton("マソ💪君")).toBe("まそ君");
  });

  it("maps look-alike digits and symbols", () => {
    expect(toSkeleton("5h1t")).toBe("shit");
    expect(toSkeleton("b1tch")).toBe("bitch");
    expect(toSkeleton("@dm1n")).toBe("admin");
  });

  it("keeps the long vowel mark", () => {
    expect(toSkeleton("おなにー")).toBe("おなにー");
  });
});

describe("terms file", () => {
  it("stores every term in skeleton form so matching works", () => {
    for (const term of [...CONTAINS_TERMS, ...TOKEN_TERMS]) {
      expect(toSkeleton(term), term).toBe(term);
    }
  });

  it("has no duplicate terms", () => {
    const all = [...CONTAINS_TERMS, ...TOKEN_TERMS];
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps token terms ASCII only (they match whole English words)", () => {
    for (const term of TOKEN_TERMS) {
      expect(term).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("covers every category", () => {
    expect(Object.keys(terms.contains).sort()).toEqual(
      ["abuse", "discrimination", "reserved", "sexual"],
    );
  });
});

describe("isNameAllowed", () => {
  it.each([
    "マソ君",
    "トレーニー",
    "筋トレ大好き",
    "Alice",
    "山田太郎",
    "たろう123",
    "ゴリラ💪",
    "Class of 2026",
    "Passage",
    "Assistant",
    "Sussex",
    "Essex Boy",
    "Hancock",
    "Peacock",
    "Dickens",
    "ころころ",
    "しねんのひ",
    "ケーキ",
    "ベンチプレス",
    "システム工学",
  ])("allows %s", (name) => {
    expect(isNameAllowed(name)).toBe(true);
  });

  it.each([
    ["abuse in kanji", "死ね"],
    ["abuse with a symbol between", "死 ✕ ね"],
    ["abuse inside a longer name", "おまえなんか殺す"],
    ["English profanity", "fuck"],
    ["fullwidth profanity", "ＦＵＣＫ"],
    ["leet profanity", "5h1t"],
    ["separated profanity", "f.u.c.k"],
    ["sexual term in katakana", "チンコ"],
    ["half-width katakana", "ﾁﾝｺ"],
    ["slur", "きちがい"],
    ["slur in kanji", "気違い"],
    ["Nazi reference", "nazi"],
    ["reserved: staff in Japanese", "運営スタッフ"],
    ["reserved: official", "Official Account"],
    ["reserved: admin as a word", "admin"],
    ["reserved: admin with digits", "@dm1n"],
    ["token: sex", "sex"],
    ["token: sex among words", "gym sex"],
    ["token: ass", "big ass"],
    ["case-insensitive", "FuCk"],
  ])("rejects %s", (_label, name) => {
    expect(isNameAllowed(name)).toBe(false);
  });

  it("matches English token terms only as whole words", () => {
    expect(isNameAllowed("assistant")).toBe(true);
    expect(isNameAllowed("ass")).toBe(false);
    expect(isNameAllowed("ass-man")).toBe(false);
  });
});

describe("integration with display names", () => {
  it("reports a blocked name with a message that does not repeat the word", () => {
    const result = validateDisplayName("fuck");
    expect(result).toMatchObject({ ok: false, problem: "not-allowed" });
    expect(!result.ok && result.message).toBe("この名前は使用できません。別の名前にしてください。");
  });

  it("checks the filter after format problems", () => {
    expect(validateDisplayName("")).toMatchObject({ problem: "empty" });
    expect(validateDisplayName("ㅤ")).toMatchObject({ problem: "invisible" });
  });

  it("can skip the filter for display of already-stored names", () => {
    expect(validateDisplayName("fuck", { filter: false }).ok).toBe(true);
    expect(displayNameOrDefault("fuck", "x")).toBe("fuck");
  });

  it("is applied by the Zod field schema", () => {
    const result = displayNameFieldSchema("表示名").safeParse("admin");
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.message).toContain("使用できません");
  });
});
