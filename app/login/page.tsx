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

  return (
    <LoginForm
      configured={isSupabaseConfigured()}
      nextPath={safeNextPath(params.next)}
      callbackFailed={params.status === "callback-error"}
    />
  );
}
