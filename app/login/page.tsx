import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { safeNextPath } from "@/lib/auth/redirect";
import { hasVerifiedSession } from "@/lib/auth/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "ログイン",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[];
    status?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);
  if (await hasVerifiedSession()) redirect(nextPath);
  const rawStatus = Array.isArray(params.status)
    ? params.status[0]
    : params.status;
  const status =
    rawStatus === "callback-error" ||
    rawStatus === "login-required" ||
    rawStatus === "session-expired"
      ? rawStatus
      : null;

  return (
    <LoginForm
      configured={isSupabaseConfigured()}
      nextPath={nextPath}
      status={status}
    />
  );
}
