import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/redirect";
import { requestOrigin } from "@/lib/auth/request-origin";
import { GUEST_COOKIE_NAME, guestCookieOptions } from "@/lib/auth/guest";
import { createClient } from "@/lib/supabase/server";

function noStoreRedirect(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = safeNextPath(request.nextUrl.searchParams.get("next"));
  const visibleOrigin = requestOrigin(request);
  const loginUrl = new URL("/login", visibleOrigin);
  loginUrl.searchParams.set("status", "callback-error");
  loginUrl.searchParams.set("next", nextPath);
  if (!code) {
    return noStoreRedirect(loginUrl);
  }

  try {
    const supabase = await createClient();
    if (!supabase) return noStoreRedirect(loginUrl);
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.session) return noStoreRedirect(loginUrl);
  } catch {
    return noStoreRedirect(loginUrl);
  }

  const response = noStoreRedirect(new URL(nextPath, visibleOrigin));
  response.cookies.set(GUEST_COOKIE_NAME, "", { ...guestCookieOptions(), maxAge: 0 });
  return response;
}
