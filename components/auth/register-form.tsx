"use client";

import { ArrowLeft, CheckCircle2, Eye, EyeOff, Mail, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

import { registrationCredentialsSchema } from "@/lib/auth/credentials";
import { createClient } from "@/lib/supabase/client";

type RegistrationField =
  | "displayName"
  | "email"
  | "password"
  | "passwordConfirmation";

type FieldErrors = Partial<Record<RegistrationField, string>>;

export function RegisterForm({
  configured,
  nextPath,
}: {
  configured: boolean;
  nextPath: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  function clearFieldError(field: RegistrationField) {
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setMessage(null);
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || isSubmitting) {
      return;
    }

    const parsed = registrationCredentialsSchema.safeParse({
      displayName,
      email,
      password,
      passwordConfirmation,
    });

    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as RegistrationField;
        errors[field] ??= issue.message;
      }
      setFieldErrors(errors);
      setMessage("入力内容を確認してください。");
      return;
    }

    setIsSubmitting(true);
    setFieldErrors({});
    setMessage(null);

    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", nextPath);

    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { display_name: parsed.data.displayName },
        emailRedirectTo: callbackUrl.toString(),
      },
    });

    setIsSubmitting(false);

    if (error) {
      setMessage(
        "アカウントを作成できませんでした。時間をおいて、もう一度お試しください。",
      );
      return;
    }

    if (data.session) {
      window.location.assign(nextPath);
      return;
    }

    setPassword("");
    setPasswordConfirmation("");
    setSubmittedEmail(parsed.data.email);
  }

  if (submittedEmail) {
    return (
      <main className="app-page--focused grid place-items-center">
        <section className="surface-panel w-full max-w-lg rounded-[34px] p-6 sm:p-9">
          <span className="grid size-14 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <CheckCircle2 aria-hidden="true" size={28} />
          </span>
          <p className="mt-6 text-xs font-black tracking-[0.14em] text-accent-strong uppercase">
            Check your email
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.05em]">
            メールを確認してください
          </h1>
          <p className="mt-4 text-sm leading-7 text-muted">
            登録できる場合は、
            <strong className="break-all text-ink">{submittedEmail}</strong>
            へ確認メールを送ります。メール内のリンクを開くと登録が完了します。
          </p>
          <p className="mt-3 text-sm leading-6 text-muted">
            すでに登録済みの場合は、新しいアカウントは作られません。ログイン画面をお使いください。
          </p>
          <Link
            href={`/login?next=${encodeURIComponent(nextPath)}`}
            className="mt-7 flex min-h-14 w-full items-center justify-center rounded-2xl bg-accent-strong px-5 font-black text-white"
          >
            ログイン画面へ
          </Link>
          <button
            type="button"
            onClick={() => setSubmittedEmail(null)}
            className="mt-3 min-h-12 w-full rounded-2xl border border-line bg-white px-5 text-sm font-bold"
          >
            入力内容を変更
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-page--focused grid place-items-center">
      <section className="surface-panel w-full max-w-lg rounded-[34px] p-6 sm:p-9">
        <Link
          href={`/login?next=${encodeURIComponent(nextPath)}`}
          className="mb-7 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-muted"
        >
          <ArrowLeft aria-hidden="true" size={18} />
          ログインへ戻る
        </Link>

        <p className="text-xs font-black tracking-[0.14em] text-accent-strong uppercase">
          First setup
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.05em]">
          アカウントを作成
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          初回だけ登録すると、あなた専用の記録・設定・マソ君が用意されます。
        </p>

        {!configured ? (
          <div className="mt-7 rounded-2xl border border-line bg-canvas/70 p-4">
            <p className="font-black">現在はローカルプレビューです</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              Supabaseの接続情報を設定したあと、この画面からアカウントを作成できます。
            </p>
          </div>
        ) : (
          <form onSubmit={handleRegister} noValidate className="mt-7">
            <div>
              <label htmlFor="register-display-name" className="mb-2 block text-sm font-black">
                表示名
              </label>
              <div className="flex min-h-14 items-center rounded-2xl border border-line bg-white px-4 focus-within:border-ink">
                <UserRound aria-hidden="true" className="shrink-0 text-muted" size={19} />
                <input
                  id="register-display-name"
                  type="text"
                  autoComplete="nickname"
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    clearFieldError("displayName");
                  }}
                  placeholder="トレーニー"
                  maxLength={30}
                  aria-invalid={Boolean(fieldErrors.displayName)}
                  aria-describedby={
                    fieldErrors.displayName ? "register-display-name-error" : undefined
                  }
                  className="min-w-0 flex-1 bg-transparent px-3 outline-none"
                />
              </div>
              {fieldErrors.displayName ? (
                <p id="register-display-name-error" className="mt-2 text-sm font-bold text-accent-strong">
                  {fieldErrors.displayName}
                </p>
              ) : null}
            </div>

            <div className="mt-4">
              <label htmlFor="register-email" className="mb-2 block text-sm font-black">
                メールアドレス
              </label>
              <div className="flex min-h-14 items-center rounded-2xl border border-line bg-white px-4 focus-within:border-ink">
                <Mail aria-hidden="true" className="shrink-0 text-muted" size={19} />
                <input
                  id="register-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    clearFieldError("email");
                  }}
                  placeholder="you@example.com"
                  maxLength={254}
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={fieldErrors.email ? "register-email-error" : undefined}
                  className="min-w-0 flex-1 bg-transparent px-3 outline-none"
                />
              </div>
              {fieldErrors.email ? (
                <p id="register-email-error" className="mt-2 text-sm font-bold text-accent-strong">
                  {fieldErrors.email}
                </p>
              ) : null}
            </div>

            <div className="mt-4">
              <label htmlFor="register-password" className="mb-2 block text-sm font-black">
                パスワード
              </label>
              <div className="flex min-h-14 items-center rounded-2xl border border-line bg-white px-4 focus-within:border-ink">
                <input
                  id="register-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clearFieldError("password");
                  }}
                  minLength={8}
                  maxLength={72}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={
                    fieldErrors.password
                      ? "register-password-help register-password-error"
                      : "register-password-help"
                  }
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
              <p id="register-password-help" className="mt-2 text-xs leading-5 text-muted">
                8〜72文字で入力してください。
              </p>
              {fieldErrors.password ? (
                <p id="register-password-error" className="mt-2 text-sm font-bold text-accent-strong">
                  {fieldErrors.password}
                </p>
              ) : null}
            </div>

            <div className="mt-4">
              <label htmlFor="register-password-confirmation" className="mb-2 block text-sm font-black">
                パスワード（確認）
              </label>
              <input
                id="register-password-confirmation"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={passwordConfirmation}
                onChange={(event) => {
                  setPasswordConfirmation(event.target.value);
                  clearFieldError("passwordConfirmation");
                }}
                minLength={8}
                maxLength={72}
                aria-invalid={Boolean(fieldErrors.passwordConfirmation)}
                aria-describedby={
                  fieldErrors.passwordConfirmation
                    ? "register-password-confirmation-error"
                    : undefined
                }
                className="min-h-14 w-full rounded-2xl border border-line bg-white px-4 outline-none focus:border-ink"
              />
              {fieldErrors.passwordConfirmation ? (
                <p
                  id="register-password-confirmation-error"
                  className="mt-2 text-sm font-bold text-accent-strong"
                >
                  {fieldErrors.passwordConfirmation}
                </p>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-5 flex min-h-14 w-full items-center justify-center rounded-2xl bg-accent-strong px-5 font-black text-white shadow-[0_6px_0_var(--accent-shadow)] active:translate-y-1 active:shadow-none disabled:cursor-wait disabled:bg-line disabled:text-muted disabled:shadow-none"
            >
              {isSubmitting ? "作成しています" : "アカウントを作成"}
            </button>
          </form>
        )}

        {message ? (
          <p role="alert" aria-live="polite" className="mt-4 text-sm font-bold text-accent-strong">
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
