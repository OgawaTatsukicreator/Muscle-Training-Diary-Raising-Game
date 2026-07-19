"use client";

import { AlertCircle } from "lucide-react";

import { useDemoData } from "@/components/providers/demo-data-provider";

export function StorageNotice() {
  const { storageIssue } = useDemoData();

  if (!storageIssue) {
    return null;
  }

  return (
    <div
      role="status"
      className="mb-5 flex gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm leading-5 text-ink"
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={18} />
      <p>{storageIssue}</p>
    </div>
  );
}
