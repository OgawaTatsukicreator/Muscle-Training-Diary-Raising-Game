import { describe, expect, it } from "vitest";

import { parseRecordPage } from "./record-pagination";

describe("record page navigation", () => {
  it("accepts direct navigation to the last page of 5000 records", () => {
    expect(parseRecordPage("200")).toBe(200);
  });

  it.each([undefined, "", "0", "-1", "1.5", "1e2", "Infinity", "9007199254740992", ["2", "3"]])(
    "starts at the first page for malformed navigation input %s",
    (value) => expect(parseRecordPage(value)).toBe(1),
  );
});
