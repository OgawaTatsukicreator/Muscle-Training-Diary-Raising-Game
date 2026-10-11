/** A local-data preference only. This cookie never authenticates a Supabase user. */
export const GUEST_COOKIE_NAME = "musclememo-guest";
export const GUEST_COOKIE_VALUE = "1";
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function guestCookieOptions() {
  return {
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
  };
}

export function isGuestCookie(cookieHeader: string): boolean {
  return cookieHeader.split(";").some((cookie) => {
    const separator = cookie.indexOf("=");
    return cookie.slice(0, separator).trim() === GUEST_COOKIE_NAME &&
      cookie.slice(separator + 1).trim() === GUEST_COOKIE_VALUE;
  });
}

export function isGuestEnabled(): boolean {
  return typeof document !== "undefined" && isGuestCookie(document.cookie);
}

export function clearGuestPreference(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${GUEST_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${
    window.location.protocol === "https:" ? "; Secure" : ""
  }`;
}
