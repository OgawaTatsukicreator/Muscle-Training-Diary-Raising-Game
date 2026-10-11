import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RegisterForm } from "@/components/auth/register-form";
import { safeNextPath } from "@/lib/auth/redirect";
import { hasVerifiedSession } from "@/lib/auth/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "アカウント作成",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);
  const configured = isSupabaseConfigured();

  if (await hasVerifiedSession()) redirect(nextPath);

  return (
    <RegisterForm
      configured={configured}
      nextPath={nextPath}
    />
  );
}
