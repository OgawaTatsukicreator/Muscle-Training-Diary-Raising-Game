"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useAppData } from "@/components/providers/app-data-provider";

export function StorageNotice() {
  const { isReady, retryStorage, storageIssue, storageMode } = useAppData();
  const [isRetrying, setIsRetrying] = useState(false);

  if (!storageIssue) {
    return null;
  }

  async function handleRetry() {
    if (isRetrying) {
      return;
    }

    setIsRetrying(true);
    await retryStorage();
    setIsRetrying(false);
  }

  return (
    <div
      role="status"
      className="mb-5 flex gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm leading-5 text-ink"
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={18} />
      <div>
        <p>{storageIssue}</p>
        {storageMode === "supabase" && !isReady ? (
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            className="mt-2 min-h-11 rounded-xl border border-ink/25 bg-white px-4 text-xs font-bold disabled:cursor-wait disabled:text-muted"
          >
            {isRetrying ? "読み込み中" : "もう一度読み込む"}
          </button>
        ) : storageMode === "signed-out" ? (
          <Link
            href="/login"
            className="mt-2 inline-flex min-h-11 items-center rounded-xl border border-ink/25 bg-white px-4 text-xs font-bold"
          >
            ログイン画面へ
          </Link>
        ) : null}
      </div>
    </div>
  );
}
