import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { guestEntryPath, isProtectedPath } from "@/lib/auth/routes";
import { GUEST_COOKIE_NAME, GUEST_COOKIE_VALUE, guestCookieOptions } from "@/lib/auth/guest";
import { safeNextPath } from "@/lib/auth/redirect";
import { requestOrigin } from "@/lib/auth/request-origin";

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

function redirectWithCookies(url: URL, response: NextResponse) {
  const redirectResponse = NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
  return privateResponse(redirectResponse);
}

export async function updateSession(request: NextRequest) {
  const config = getSupabasePublicConfig();

  const guest = request.cookies.get(GUEST_COOKIE_NAME)?.value === GUEST_COOKIE_VALUE;
  const hadAuthSession = request.cookies.getAll().some((cookie) =>
    /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name),
  );
  let response = NextResponse.next({ request });
  let authenticated = false;
  if (config) {
    try {
      const supabase = createServerClient(config.url, config.publishableKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet, headers) {
            for (const { name, value } of cookiesToSet) {
              request.cookies.set(name, value);
            }

            const previousCookies = response.cookies.getAll();
            const previousHeaders = new Headers(response.headers);
            response = NextResponse.next({ request });
            for (const cookie of previousCookies) response.cookies.set(cookie);
            for (const [name, value] of previousHeaders) {
              if (!name.startsWith("x-middleware-") && name !== "set-cookie") response.headers.set(name, value);
            }

            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, options);
            }

            for (const [name, value] of Object.entries(headers)) {
              response.headers.set(name, value);
            }
          },
        },
      });
      const { data, error } = await supabase.auth.getClaims();
      authenticated = !error && Boolean(data?.claims?.sub);
    } catch {
      // Auth outages cannot grant cloud access; an explicitly chosen guest can use local data.
    }
  }

  if (authenticated && guest) {
    response.cookies.set(GUEST_COOKIE_NAME, "", { ...guestCookieOptions(), maxAge: 0 });
  }

  if (authenticated && ["/welcome", "/login", "/register"].includes(request.nextUrl.pathname)) {
    return redirectWithCookies(new URL(safeNextPath(request.nextUrl.searchParams.get("next")), requestOrigin(request)), response);
  }

  if (!authenticated && !guest && isProtectedPath(request.nextUrl.pathname)) {
    const loginUrl = new URL(guestEntryPath(
      `${request.nextUrl.pathname}${request.nextUrl.search}`, hadAuthSession,
    ), requestOrigin(request));
    return redirectWithCookies(loginUrl, response);
  }

  const pathname = request.nextUrl.pathname;
  return isProtectedPath(pathname) || ["/welcome", "/login", "/register"].includes(pathname) || pathname.startsWith("/auth/")
    ? privateResponse(response)
    : response;
}
