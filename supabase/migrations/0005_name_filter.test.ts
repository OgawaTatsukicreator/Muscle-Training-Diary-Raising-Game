import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CONTAINS_TERMS,
  SKELETON_KEEP_CLASS,
  TOKEN_TERMS,
} from "@/lib/domain/name-filter";

const sql = readFileSync(
  new URL("./0005_name_filter.sql", import.meta.url),
  "utf8",
);

function arrayLiterals(): string[][] {
  return [...sql.matchAll(/array\[([^\]]*)\]::text\[\]/g)].map(([, body]) =>
    [...body.matchAll(/'([^']*)'/g)].map(([, term]) => term),
  );
}

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const next = sql.indexOf("create or replace function public.", start + 1);

  return sql.slice(start, next === -1 ? sql.length : next);
}

describe("name filter migration contract", () => {
  it("embeds exactly the vocabulary of lib/domain/name-filter-terms.json", () => {
    const [contains, tokens] = arrayLiterals();

    expect(contains).toEqual([...CONTAINS_TERMS]);
    expect(tokens).toEqual([...TOKEN_TERMS]);
  });

  it("keeps the same character set as the client skeleton", () => {
    // The client holds real characters; the SQL file spells them as \uXXXX.
    const escaped = [...SKELETON_KEEP_CLASS]
      .map((char) =>
        (char.codePointAt(0) ?? 0) > 0x7f
          ? `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`
          : char,
      )
      .join("");

    expect(sql).toContain(`'[^${escaped}]'`);
  });

  it("converts katakana to hiragana over the same range as the client", () => {
    let katakana = "";
    let hiragana = "";
    for (let code = 0x30a1; code <= 0x30f6; code += 1) {
      katakana += String.fromCodePoint(code);
      hiragana += String.fromCodePoint(code - 0x60);
    }

    expect(sql).toContain(`'${katakana}'`);
    expect(sql).toContain(`'${hiragana}'`);
  });

  it("applies the same digit look-alike mapping", () => {
    expect(sql.match(/'01345@\$',\s*'oieasas'/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects blocked names with a distinguishable error in both write paths", () => {
    for (const name of ["rename_maso", "update_display_name"]) {
      const body = functionBody(name);

      expect(body).toContain("if not public.is_name_allowed(v_name) then");
      expect(body).toContain("raise exception 'name not allowed' using errcode = '22023';");
      // The filter runs after normalization and the length check.
      expect(body.indexOf("normalize_display_name")).toBeLessThan(
        body.indexOf("is_name_allowed"),
      );
    }
  });

  it("does not turn the filter into a table constraint", () => {
    expect(sql).not.toMatch(/add constraint[^;]*is_name_allowed/);
  });

  it("falls back to the default name instead of failing sign-up", () => {
    const body = functionBody("initialize_new_user");

    expect(body).toContain("if not public.is_name_allowed(v_display_name) then");
    expect(body).toContain("v_display_name := 'トレーニー';");
  });

  it("keeps the helper functions immutable and path-safe", () => {
    for (const name of ["name_skeleton", "is_name_allowed"]) {
      const body = functionBody(name);

      expect(body).toContain("immutable");
      expect(body).toContain("set search_path = ''");
    }
  });
});
