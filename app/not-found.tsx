import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="app-page--focused grid place-items-center">
      <section className="surface-panel w-full max-w-lg rounded-[34px] p-7 text-center">
        <p className="data-number text-5xl font-black text-accent">404</p>
        <h1 className="mt-4 text-2xl font-black">ページが見つかりません</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          URLが変わったか、対象の記録が削除された可能性があります。
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-6 font-black text-white"
        >
          <ArrowLeft aria-hidden="true" size={18} />
          ホームへ戻る
        </Link>
      </section>
    </main>
  );
}
