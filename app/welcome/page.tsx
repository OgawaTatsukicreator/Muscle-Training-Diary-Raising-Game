import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Dumbbell } from "lucide-react";

import { safeNextPath } from "@/lib/auth/redirect";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "はじめての方へ" };

export default async function WelcomePage({ searchParams }: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const nextPath = safeNextPath((await searchParams).next);
  const configured = isSupabaseConfigured();
  if (configured) {
    const supabase = await createClient();
    const { data } = (await supabase?.auth.getClaims()) ?? { data: null };
    if (data?.claims) redirect(nextPath);
  }

  return (
    <main className="app-page--focused flex flex-col justify-center">
      <section className="mx-auto w-full max-w-md py-6 sm:py-10" aria-labelledby="welcome-title">
        <p className="flex items-center gap-2 text-sm font-bold text-accent-strong">
          <Dumbbell size={20} aria-hidden="true" />筋トレMEMO
        </p>
        <div className="mt-6 flex items-center justify-between gap-4 border-y border-line py-5">
          <div>
            <p className="text-xs font-bold text-muted">はじめての方へ</p>
            <h1 id="welcome-title" className="mt-2 text-3xl leading-tight font-black tracking-tight">マソ君の日常</h1>
            <p className="mt-3 text-sm leading-7">筋トレを記録して、<br />あなただけのマソ君を育てよう。</p>
          </div>
          <Image src="/maso/phases-50/phase-01.svg" alt="これから一緒に成長するマソ君" width={120} height={156} priority className="w-24 shrink-0 sm:w-28" />
        </div>
        <div className="py-6">
          <h2 className="text-base font-bold">最初に、アカウントを作成します</h2>
          <p className="mt-3 text-sm leading-7 text-muted">登録は初回だけ。トレーニング記録・育成状態・設定は、ログインしたアカウントごとに保存します。</p>
          <p className="mt-2 text-xs leading-6 text-muted">表示名・メールアドレス・パスワードを入力してはじめられます。</p>
        </div>
        <Link href={`/register?next=${encodeURIComponent(nextPath)}`} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent-strong px-4 font-bold text-white shadow-[0_5px_0_var(--accent-shadow)] active:translate-y-1 active:shadow-none">
          初回登録してはじめる<ArrowRight size={18} aria-hidden="true" />
        </Link>
        <div className="mt-7 border-t border-line pt-5 text-center">
          <p className="text-xs text-muted">すでに登録した方はこちら</p>
          <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="mt-2 flex min-h-12 w-full items-center justify-center rounded-2xl border border-line bg-white font-bold">ログイン</Link>
        </div>
        {!configured ? <div className="mt-5 rounded-xl bg-canvas p-4 text-xs leading-6 text-muted">
          <p>現在は接続設定前のプレビューです。アカウント登録にはSupabaseへの接続設定が必要です。</p>
          <Link href="/" className="mt-2 inline-flex min-h-11 items-center font-bold text-accent-strong underline underline-offset-4">端末内のプレビューを開く</Link>
        </div> : null}
      </section>
    </main>
  );
}
