import type { NextRequest } from "next/server";

/** Retain the browser-facing origin when Next normalizes an internal URL. */
export function requestOrigin(request: NextRequest): string {
  const host = (request.headers.get("host") ?? request.nextUrl.host).toLowerCase();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const protocol = forwardedProtocol === "https" || forwardedProtocol === "http"
    ? `${forwardedProtocol}:`
    : request.nextUrl.protocol;
  try {
    const origin = new URL(`${protocol}//${host}`);
    if (origin.host.toLowerCase() === host && !origin.username && !origin.password) return origin.origin;
  } catch {
    // Invalid Host input cannot become a redirect destination.
  }
  return request.nextUrl.origin;
}
