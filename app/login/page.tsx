import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { safeNextPath } from "@/lib/auth/redirect";
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
      nextPath={safeNextPath(params.next)}
      status={status}
    />
  );
}
