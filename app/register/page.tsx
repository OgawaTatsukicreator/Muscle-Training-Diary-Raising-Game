import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RegisterForm } from "@/components/auth/register-form";
import { safeNextPath } from "@/lib/auth/redirect";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

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

  if (configured) {
    const supabase = await createClient();
    const { data } = (await supabase?.auth.getClaims()) ?? { data: null };

    if (data?.claims) {
      redirect(nextPath);
    }
  }

  return (
    <RegisterForm
      configured={configured}
      nextPath={nextPath}
    />
  );
}
