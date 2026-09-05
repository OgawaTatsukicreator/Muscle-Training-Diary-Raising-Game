"use client";

import { ArrowLeft, Eye, EyeOff, LogIn, LogOut, Mail } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { loginCredentialsSchema } from "@/lib/auth/credentials";
import { createClient } from "@/lib/supabase/client";

type LoginFormProps = {
  configured: boolean;
  nextPath: string;
  status: "callback-error" | "login-required" | "session-expired" | null;
};

type LoginField = "email" | "password";
type FieldErrors = Partial<Record<LoginField, string>>;

function statusMessage(status: LoginFormProps["status"]): string | null {
  switch (status) {
    case "callback-error":
      return "メールアドレスの確認に失敗しました。もう一度ログインしてください。";
    case "login-required":
      return "このページを使うにはログインしてください。";
    case "session-expired":
      return "ログインの有効期限が切れました。もう一度ログインしてください。";
    default:
      return null;
  }
}

export function LoginForm({ configured, nextPath, status }: LoginFormProps) {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(configured);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(() =>
    statusMessage(status),
  );

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setIsSignedIn(Boolean(data.session));
        setIsCheckingSession(false);
      }
    });

    return () => {
      active = false;
    };
  }, [supabase]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || isSubmitting) {
      return;
    }

    const parsed = loginCredentialsSchema.safeParse({ email, password });

    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as LoginField;
        errors[field] ??= issue.message;
      }
      setFieldErrors(errors);
      setMessage("入力内容を確認してください。");
      return;
    }

    setIsSubmitting(true);
    setFieldErrors({});
    setMessage(null);

    const { error } = await supabase.auth.signInWithPassword(parsed.data);

    if (error) {
      setIsSubmitting(false);
      setMessage(
        "ログインできませんでした。メールアドレスとパスワードを確認してください。",
      );
      return;
    }

    window.location.assign(nextPath);
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
          href={`/welcome?next=${encodeURIComponent(nextPath)}`}
          className="mb-7 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-muted"
        >
          <ArrowLeft aria-hidden="true" size={18} />
          はじめの画面へ
        </Link>

        <p className="text-xs font-black tracking-[0.14em] text-accent-strong uppercase">
          Account
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.05em]">ログイン</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          登録したメールアドレスとパスワードで、あなたの記録を開きます。
        </p>

        {!configured ? (
          <div className="mt-7 rounded-2xl border border-line bg-canvas/70 p-4">
            <p className="font-black">現在はローカルプレビューです</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              Supabaseの接続情報を設定すると、アカウントごとに記録を保存できます。今は端末内だけに保存します。
            </p>
          </div>
        ) : isCheckingSession ? (
          <div
            className="mt-7 h-14 animate-pulse rounded-2xl bg-canvas"
            aria-label="ログイン状態を確認中"
          />
        ) : isSignedIn ? (
          <div className="mt-7">
            <p className="rounded-2xl border border-line bg-canvas/70 p-4 text-sm font-bold">
              この端末ではログイン済みです。
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Link
                href={nextPath}
                className="flex min-h-13 items-center justify-center rounded-2xl bg-accent-strong px-5 font-black text-white"
              >
                アプリへ戻る
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                disabled={isSubmitting}
                className="flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-5 font-black disabled:cursor-wait disabled:text-muted"
              >
                <LogOut aria-hidden="true" size={19} />
                {isSubmitting ? "ログアウト中" : "ログアウト"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <form onSubmit={handleLogin} noValidate className="mt-7">
              <div>
                <label htmlFor="login-email" className="mb-2 block text-sm font-black">
                  メールアドレス
                </label>
                <div className="flex min-h-14 items-center rounded-2xl border border-line bg-white px-4 focus-within:border-ink">
                  <Mail aria-hidden="true" className="shrink-0 text-muted" size={19} />
                  <input
                    id="login-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setFieldErrors((current) => ({ ...current, email: undefined }));
                      setMessage(null);
                    }}
                    placeholder="you@example.com"
                    maxLength={254}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
                    className="min-w-0 flex-1 bg-transparent px-3 outline-none"
                  />
                </div>
                {fieldErrors.email ? (
                  <p id="login-email-error" className="mt-2 text-sm font-bold text-accent-strong">
                    {fieldErrors.email}
                  </p>
                ) : null}
              </div>

              <div className="mt-4">
                <label htmlFor="login-password" className="mb-2 block text-sm font-black">
                  パスワード
                </label>
                <div className="flex min-h-14 items-center rounded-2xl border border-line bg-white px-4 focus-within:border-ink">
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setFieldErrors((current) => ({ ...current, password: undefined }));
                      setMessage(null);
                    }}
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
                    className="min-w-0 flex-1 bg-transparent outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
                    className="grid size-11 shrink-0 place-items-center rounded-full text-muted"
                  >
                    {showPassword ? (
                      <EyeOff aria-hidden="true" size={19} />
                    ) : (
                      <Eye aria-hidden="true" size={19} />
                    )}
                  </button>
                </div>
                {fieldErrors.password ? (
                  <p id="login-password-error" className="mt-2 text-sm font-bold text-accent-strong">
                    {fieldErrors.password}
                  </p>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent-strong px-5 font-black text-white shadow-[0_6px_0_var(--accent-shadow)] active:translate-y-1 active:shadow-none disabled:cursor-wait disabled:bg-line disabled:text-muted disabled:shadow-none"
              >
                <LogIn aria-hidden="true" size={20} />
                {isSubmitting ? "ログインしています" : "ログイン"}
              </button>
            </form>

            <p className="mt-6 border-t border-line pt-5 text-center text-sm text-muted">
              初めて使う方は
              <Link
                href={`/register?next=${encodeURIComponent(nextPath)}`}
                className="ml-1 font-black text-accent-strong underline underline-offset-4"
              >
                アカウントを作成
              </Link>
            </p>
          </>
        )}

        {message ? (
          <p
            role={fieldErrors.email || fieldErrors.password ? "alert" : "status"}
            aria-live="polite"
            className="mt-4 text-sm font-bold text-accent-strong"
          >
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
