import { createClient } from "@/lib/supabase/server";

/** Verify claims on the server; an unavailable auth service must not admit a user. */
export async function hasVerifiedSession(): Promise<boolean> {
  try {
    const supabase = await createClient();
    if (!supabase) return false;
    const { data, error } = await supabase.auth.getClaims();
    return !error && Boolean(data?.claims?.sub);
  } catch {
    return false;
  }
}
