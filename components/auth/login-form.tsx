"use client";

import { ArrowLeft, LogIn, LogOut, Mail } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";

type LoginFormProps = {
  configured: boolean;
  nextPath: string;
  callbackFailed: boolean;
};

export function LoginForm({ configured, nextPath, callbackFailed }: LoginFormProps) {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [message, setMessage] = useState<string | null>(
    callbackFailed
      ? "ログインリンクを確認できませんでした。新しいリンクを送り直してください。"
      : null,
  );

  useEffect(() => {
    if (!supabase) {
      return;
    }

    void supabase.auth.getSession().then(({ data }) => {
      setIsSignedIn(Boolean(data.session));
    });
  }, [supabase]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || isSubmitting) {
      return;
    }

    const normalizedEmail = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
      setMessage("メールアドレスを確認してください。");
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", nextPath);

    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { emailRedirectTo: callbackUrl.toString() },
    });

    setIsSubmitting(false);
    setMessage(
      error
        ? "ログインメールを送れませんでした。少し待ってからお試しください。"
        : "ログイン用リンクを送りました。メールを確認してください。",
    );
  }

  async function handleLogout() {
    if (!supabase || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.auth.signOut();
    setIsSubmitting(false);

    if (error) {
      setMessage("ログアウトできませんでした。もう一度お試しください。");
      return;
    }

    setIsSignedIn(false);
    setMessage("ログアウトしました。");
  }

  return (
    <main className="app-page--focused grid place-items-center">
      <section className="surface-panel w-full max-w-lg rounded-[34px] p-6 sm:p-9">
        <Link
          href="/"
          className="mb-7 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-muted"
        >
          <ArrowLeft aria-hidden="true" size={18} />
          ホームへ戻る
        </Link>

        <p className="text-xs font-black tracking-[0.14em] text-accent-strong uppercase">
          Account
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.05em]">ログイン</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          パスワードは不要です。入力したメールアドレスへ、一度だけ使えるログイン用リンクを送ります。
        </p>

        {!configured ? (
          <div className="mt-7 rounded-2xl border border-line bg-canvas/70 p-4">
            <p className="font-black">現在はローカルプレビューです</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              Supabaseの接続情報を設定すると、この画面からログインできるようになります。今は端末内だけに記録を保存します。
            </p>
          </div>
        ) : isSignedIn ? (
          <button
            type="button"
            onClick={handleLogout}
            disabled={isSubmitting}
            className="mt-7 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-white px-5 font-black"
          >
            <LogOut aria-hidden="true" size={19} />
            ログアウト
          </button>
        ) : (
          <form onSubmit={handleLogin} noValidate className="mt-7">
            <label htmlFor="email" className="mb-2 block text-sm font-black">
              メールアドレス
            </label>
            <div className="flex min-h-14 items-center rounded-2xl border border-line bg-white px-4 focus-within:border-ink">
              <Mail aria-hidden="true" className="shrink-0 text-muted" size={19} />
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                maxLength={254}
                className="min-w-0 flex-1 bg-transparent px-3 outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent-strong px-5 font-black text-white shadow-[0_6px_0_var(--accent-shadow)] active:translate-y-1 active:shadow-none disabled:cursor-wait disabled:bg-line disabled:text-muted disabled:shadow-none"
            >
              <LogIn aria-hidden="true" size={20} />
              {isSubmitting ? "送信しています" : "ログイン用リンクを送る"}
            </button>
          </form>
        )}

        {message ? (
          <p role="status" aria-live="polite" className="mt-4 text-sm font-bold text-muted">
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
