import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/redirect";
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
  const supabase = await createClient();

  if (!code || !supabase) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("status", "callback-error");
    loginUrl.searchParams.set("next", nextPath);
    return noStoreRedirect(loginUrl);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("status", "callback-error");
    loginUrl.searchParams.set("next", nextPath);
    return noStoreRedirect(loginUrl);
  }

  return noStoreRedirect(new URL(nextPath, request.url));
}
