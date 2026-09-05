import { describe, expect, it } from "vitest";

import { guestEntryPath, isProtectedPath } from "@/lib/auth/routes";

describe("isProtectedPath", () => {
  it.each(["/", "/records", "/records/", "/records/entry-123", "/analytics", "/analytics/monthly"])(
    "protects the application route %s",
    (pathname) => {
      expect(isProtectedPath(pathname)).toBe(true);
    },
  );

  it.each(["/welcome", "/register", "/login", "/auth/callback", "/records-old", "/records2", "/analytics-report", "/analytics2"])(
    "does not protect the public or similarly named route %s",
    (pathname) => {
      expect(isProtectedPath(pathname)).toBe(false);
    },
  );
});

describe("guestEntryPath", () => {
  it("sends a first-time visitor to welcome with the requested path and query intact", () => {
    const destination = new URL(
      guestEntryPath("/records?date=2026-09-06&view=week", false),
      "https://fitness.example.test",
    );

    expect(destination.pathname).toBe("/welcome");
    expect(destination.searchParams.get("next")).toBe("/records?date=2026-09-06&view=week");
    expect(destination.searchParams.has("status")).toBe(false);
  });

  it("sends a returning visitor with an expired session to login", () => {
    const destination = new URL(guestEntryPath("/analytics", true), "https://fitness.example.test");

    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("next")).toBe("/analytics");
    expect(destination.searchParams.get("status")).toBe("session-expired");
  });

  it.each([
    "https://outside.example.test/records",
    "//outside.example.test/records",
    "/\\outside.example.test/records",
    "/records/../login",
    "/records/%2e%2e/login",
    "/records-old",
    "/analytics2",
    "/records\n",
  ])("replaces an unsafe next value with home: %j", (next) => {
    for (const hadSession of [false, true]) {
      const destination = new URL(guestEntryPath(next, hadSession), "https://fitness.example.test");

      expect(destination.origin).toBe("https://fitness.example.test");
      expect(destination.searchParams.get("next")).toBe("/");
    }
  });

  it("keeps next query parameters inside next instead of injecting entry-page parameters", () => {
    const next = "/records?next=https://outside.example.test&status=forged#fragment";
    const destination = new URL(guestEntryPath(next, false), "https://fitness.example.test");

    expect(destination.searchParams.get("next")).toBe(
      "/records?next=https://outside.example.test&status=forged",
    );
    expect(destination.searchParams.has("status")).toBe(false);
    expect(destination.hash).toBe("");
  });
});
