import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it("keeps supported in-app routes and queries", () => {
    expect(safeNextPath("/records?date=2026-07-17")).toBe(
      "/records?date=2026-07-17",
    );
    expect(safeNextPath("/analytics")).toBe("/analytics");
  });

  it("rejects absolute, protocol-relative, and backslash redirects", () => {
    expect(safeNextPath("https://example.com")).toBe("/");
    expect(safeNextPath("//example.com")).toBe("/");
    expect(safeNextPath("/\\example.com")).toBe("/");
  });

  it("checks the route again after URL normalization", () => {
    expect(safeNextPath("/records/../login")).toBe("/");
    expect(safeNextPath("/not-an-app-route")).toBe("/");
  });
});
