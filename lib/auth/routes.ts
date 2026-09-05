import { safeNextPath } from "@/lib/auth/redirect";

export function isProtectedPath(pathname: string): boolean {
  return pathname === "/" || ["/records", "/analytics"].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function guestEntryPath(next: string, hadSession: boolean): string {
  const query = new URLSearchParams({ next: safeNextPath(next) });
  if (hadSession) query.set("status", "session-expired");
  return `${hadSession ? "/login" : "/welcome"}?${query}`;
}
