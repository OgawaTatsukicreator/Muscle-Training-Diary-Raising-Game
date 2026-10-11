"use client";

import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useAppData } from "@/components/providers/app-data-provider";
import { clearGuestPreference } from "@/lib/auth/guest";
import { createClient } from "@/lib/supabase/client";

export function AccountAccessControls() {
  const { storageMode, profile } = useAppData();
  const supabase = useMemo(() => createClient(), []);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cloud = storageMode === "supabase";

  async function leave() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (cloud) {
        if (!supabase) throw new Error("Auth unavailable");
        const result = await supabase.auth.signOut({ scope: "local" });
        if (result.error) throw result.error;
      }
      clearGuestPreference();
      window.location.assign("/welcome");
    } catch {
      setError("退室できませんでした。通信状態を確認して、もう一度お試しください。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (storageMode !== "local" && !cloud) return null;
  return (
    <div className="mt-4 border-t border-ink/15 pt-3 text-sm">
      <p className="flex items-center gap-2 font-bold"><UserRound size={17} aria-hidden="true" />
        {cloud ? `${profile.displayName}でログイン中` : "ゲストで利用中"}
      </p>
      <p className="mt-2 text-xs leading-6 text-muted">
        {cloud ? "記録はアカウントに保存されます。次回もこのブラウザで自動ログインできます。"
          : "記録はこのブラウザに保存されます。登録・ログイン後のデータとは別に管理され、自動移行はされません。"}
      </p>
      {!cloud ? <div className="mt-2 grid grid-cols-2 gap-2">
        <Link href="/register" className="flex min-h-11 items-center justify-center rounded-xl border border-ink/25 font-bold">初回登録</Link>
        <Link href="/login" className="flex min-h-11 items-center justify-center rounded-xl border border-ink/25 font-bold">ログイン</Link>
      </div> : null}
      <button type="button" onClick={leave} disabled={busy} aria-busy={busy}
        className="mt-2 flex min-h-11 w-full items-center gap-2 font-bold disabled:cursor-wait disabled:text-muted">
        <LogOut size={17} aria-hidden="true" />{busy ? "退室しています" : cloud ? "ログアウト" : "ゲストを退室する"}
      </button>
      {error ? <p role="alert" className="mt-2 text-xs text-accent-strong">{error}</p> : null}
    </div>
  );
}
