"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { StorageNotice } from "@/components/common/storage-notice";
import { useAppData } from "@/components/providers/app-data-provider";
import { WorkoutEntryForm } from "@/components/workout/workout-entry-form";

/**
 * 保存済みの記録を編集する画面。記録の読み込みを待ち、見つからない場合
 * (削除済み・別アカウントの記録・不正なURL)は編集フォームを出さずに案内する。
 */
export function WorkoutEditScreen({ workoutId }: { workoutId: string }) {
  const { records, isReady } = useAppData();
  const record = records.find((item) => item.id === workoutId);

  if (!isReady) {
    return (
      <main className="app-page--focused">
        <div role="status" aria-live="polite" className="mt-10 rounded-xl border border-line bg-canvas p-8 text-center text-sm text-muted">
          記録を読み込んでいます。
        </div>
      </main>
    );
  }

  if (!record) {
    return (
      <main className="app-page--focused">
        <StorageNotice />
        <div role="alert" className="mt-10 rounded-xl border border-line bg-white p-6 text-center">
          <h1 className="text-base font-semibold">記録が見つかりません</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            すでに削除されたか、この端末・アカウントにない記録です。
          </p>
          <Link
            href="/records"
            className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-bold text-white"
          >
            <ArrowLeft aria-hidden="true" size={17} />
            記録の一覧へ戻る
          </Link>
        </div>
      </main>
    );
  }

  return (
    <WorkoutEntryForm key={record.id} initialDate={record.workoutDate} editing={record} />
  );
}
