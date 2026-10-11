import { NextResponse, type NextRequest } from "next/server";

import { GUEST_COOKIE_NAME, GUEST_COOKIE_VALUE, guestCookieOptions } from "@/lib/auth/guest";
import { safeNextPath } from "@/lib/auth/redirect";
import { requestOrigin } from "@/lib/auth/request-origin";
import { hasVerifiedSession } from "@/lib/auth/server";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  // Next may normalize the internal request URL to localhost. The Host header
  // retains the browser-facing host (and port); browsers cannot override it.
  const visibleOrigin = requestOrigin(request);
  let originAllowed = !origin;
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      originAllowed = ["http:", "https:"].includes(parsedOrigin.protocol) && parsedOrigin.origin === visibleOrigin;
    } catch {
      originAllowed = false;
    }
  }
  if (!originAllowed || request.headers.get("sec-fetch-site") === "cross-site") {
    return new NextResponse("この操作はアプリの画面から実行してください。", { status: 403 });
  }

  let nextPath = "/";
  try {
    const formData = await request.formData();
    const next = formData.get("next");
    nextPath = safeNextPath(typeof next === "string" ? next : null);
  } catch {
    return new NextResponse("画面を開き直して、もう一度お試しください。", { status: 400 });
  }

  const response = NextResponse.redirect(new URL(nextPath, visibleOrigin), 303);
  response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  if (await hasVerifiedSession()) {
    response.cookies.set(GUEST_COOKIE_NAME, "", { ...guestCookieOptions(), maxAge: 0 });
  } else {
    response.cookies.set(GUEST_COOKIE_NAME, GUEST_COOKIE_VALUE, guestCookieOptions());
  }
  return response;
}
