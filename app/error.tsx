"use client";

import { RotateCcw } from "lucide-react";

export default function ErrorPage({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main className="app-page--focused grid place-items-center">
      <section className="surface-panel w-full max-w-lg rounded-[34px] p-7 text-center">
        <p className="text-xs font-black tracking-[0.14em] text-accent-strong uppercase">
          Something went wrong
        </p>
        <h1 className="mt-3 text-2xl font-black">画面を読み込めませんでした</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          入力した内容はそのまま残っている場合があります。通信状態を確認して、もう一度お試しください。
        </p>
        <button
          type="button"
          onClick={unstable_retry}
          className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-ink px-6 font-black text-white"
        >
          <RotateCcw aria-hidden="true" size={18} />
          もう一度読み込む
        </button>
      </section>
    </main>
  );
}
