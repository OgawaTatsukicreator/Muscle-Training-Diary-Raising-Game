import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  INVISIBLE_CHARACTERS,
  NAME_MAX_LENGTH,
  WHITESPACE_CHARACTERS,
} from "@/lib/domain/display-name";

const sql = readFileSync(
  new URL("./0004_display_name_normalization.sql", import.meta.url),
  "utf8",
);

describe("display name normalization migration contract", () => {
  it("removes exactly the characters lib/domain/display-name.ts removes", () => {
    // PostgreSQL text cannot hold NUL, so the SQL class starts at U+0001.
    const sqlInvisible = INVISIBLE_CHARACTERS.replace("\\u0000-", "\\u0001-");

    expect(sql).toContain(`'[${sqlInvisible}]'`);
  });

  it("collapses exactly the whitespace lib/domain/display-name.ts collapses", () => {
    expect(sql).toContain(`'[${WHITESPACE_CHARACTERS}]+'`);
  });

  it("uses the same maximum length", () => {
    expect(sql).toContain(`left(public.normalize_display_name(p_name), ${NAME_MAX_LENGTH})`);
    expect(
      sql.match(new RegExp(`char_length\\(v_name\\) not between 1 and ${NAME_MAX_LENGTH}`, "g")),
    ).toHaveLength(2);
  });

  it("normalizes with NFC like String.prototype.normalize('NFC')", () => {
    expect(sql).toContain("normalize(coalesce(p_name, ''), NFC)");
  });

  it("keeps the helper immutable and path-safe so it can back a CHECK constraint", () => {
    const helper = sql.slice(
      sql.indexOf("create or replace function public.normalize_display_name"),
      sql.indexOf("create or replace function public.clean_display_name"),
    );

    expect(helper).toContain("immutable");
    expect(helper).toContain("set search_path = ''");
  });

  it("stops clients from writing the display name directly", () => {
    expect(sql).toContain("revoke update (display_name) on public.profiles from authenticated;");
    expect(sql).toContain("grant execute on function public.update_display_name(text) to authenticated;");
  });

  it("repairs stored names before adding the constraints", () => {
    const repairProfiles = sql.indexOf("update public.profiles");
    const constraint = sql.indexOf("add constraint profiles_display_name_normalized");

    expect(repairProfiles).toBeGreaterThan(-1);
    expect(repairProfiles).toBeLessThan(constraint);
    expect(sql).toContain("add constraint maso_status_name_normalized");
  });

  it("does not fail sign-up for an unusable display name", () => {
    expect(sql).toContain("public.clean_display_name(new.raw_user_meta_data ->> 'display_name', 'トレーニー')");
  });
});
