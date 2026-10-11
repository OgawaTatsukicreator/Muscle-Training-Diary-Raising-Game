import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Dumbbell } from "lucide-react";

import { GuestEntry } from "@/components/auth/guest-entry";
import { safeNextPath } from "@/lib/auth/redirect";
import { hasVerifiedSession } from "@/lib/auth/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "はじめての方へ" };

export default async function WelcomePage({ searchParams }: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const nextPath = safeNextPath((await searchParams).next);
  const configured = isSupabaseConfigured();
  if (await hasVerifiedSession()) redirect(nextPath);

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
          <Image src="/maso/optimized/phase-01.webp" alt="これから一緒に成長するマソ君" width={120} height={180} sizes="112px" priority className="w-24 shrink-0 sm:w-28" />
        </div>
        <div className="py-6">
          <h2 className="text-base font-bold">記録をアカウントに保存しよう</h2>
          <p className="mt-3 text-sm leading-7 text-muted">登録は初回だけ。トレーニング記録・育成状態・設定をアカウントに保存し、次回からはログイン状態を保ってすぐに開きます。</p>
          <p className="mt-2 text-xs leading-6 text-muted">表示名・メールアドレス・パスワードを入力してはじめられます。</p>
        </div>
        <Link href={`/register?next=${encodeURIComponent(nextPath)}`} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent-strong px-4 font-bold text-white shadow-[0_5px_0_var(--accent-shadow)] active:translate-y-1 active:shadow-none">
          初回登録してはじめる<ArrowRight size={18} aria-hidden="true" />
        </Link>
        <div className="mt-7 border-t border-line pt-5 text-center">
          <p className="text-xs text-muted">すでに登録した方はこちら</p>
          <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="mt-2 flex min-h-12 w-full items-center justify-center rounded-2xl border border-line bg-white font-bold">ログイン</Link>
        </div>
        <GuestEntry nextPath={nextPath} />
        {!configured ? <div className="mt-5 rounded-xl bg-canvas p-4 text-xs leading-6 text-muted">
          <p>現在、アカウント登録の準備中です。ゲストとして記録をはじめられます。</p>
        </div> : null}
      </section>
    </main>
  );
}
