import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { guestEntryPath, isProtectedPath } from "@/lib/auth/routes";

export async function updateSession(request: NextRequest) {
  const config = getSupabasePublicConfig();

  if (!config) {
    return NextResponse.next();
  }

  const hadAuthSession = request.cookies.getAll().some((cookie) =>
    /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name),
  );
  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

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

  if ((error || !data?.claims) && isProtectedPath(request.nextUrl.pathname)) {
    const loginUrl = new URL(guestEntryPath(
      `${request.nextUrl.pathname}${request.nextUrl.search}`, hadAuthSession,
    ), request.url);
    const redirectResponse = NextResponse.redirect(loginUrl);

    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }

    redirectResponse.headers.set(
      "Cache-Control",
      "private, no-cache, no-store, must-revalidate, max-age=0",
    );
    redirectResponse.headers.set("Expires", "0");
    redirectResponse.headers.set("Pragma", "no-cache");
    return redirectResponse;
  }

  return response;
}
