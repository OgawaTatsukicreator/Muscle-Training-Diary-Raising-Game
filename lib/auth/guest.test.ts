import { afterEach, describe, expect, it, vi } from "vitest";

import { clearGuestPreference, guestCookieOptions, isGuestCookie, isGuestEnabled } from "@/lib/auth/guest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("local guest preference", () => {
  it("reads only the explicit marker from cookie lists", () => {
    expect(isGuestCookie("theme=dark; musclememo-guest=1; other=yes")).toBe(true);
    for (const cookie of ["", "musclememo-guest=0", "musclememo-guest=true", "other-musclememo-guest=1", "musclememo-guest"]) {
      expect(isGuestCookie(cookie)).toBe(false);
    }
  });

  it("is safe during server rendering", () => {
    expect(isGuestEnabled()).toBe(false);
    expect(() => clearGuestPreference()).not.toThrow();
  });

  it("expires the same browser preference after account login", () => {
    const document = { cookie: "musclememo-guest=1" };
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", { location: { protocol: "https:" } });
    expect(isGuestEnabled()).toBe(true);
    clearGuestPreference();
    expect(document.cookie).toBe("musclememo-guest=; Path=/; Max-Age=0; SameSite=Lax; Secure");
  });

  it("keeps the one-year production preference readable without making it an auth token", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(guestCookieOptions()).toEqual({ path: "/", maxAge: 31_536_000, sameSite: "lax", secure: true, httpOnly: false });
  });
});
