"use client";

import { BarChart3, Dumbbell, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { PageHeading } from "@/components/common/page-heading";
import { StorageNotice } from "@/components/common/storage-notice";
import { useDemoData } from "@/components/providers/demo-data-provider";
import { parseDateKey } from "@/lib/domain/date";
import {
  BODY_PART_LABELS,
  BODY_PARTS,
  formatVolume,
} from "@/lib/domain/workout";

function dateKeyFromUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function AnalyticsDashboard({ today }: { today: string }) {
  const { records, isReady } = useDemoData();
  const dailyData = useMemo(() => {
    const todayDate = parseDateKey(today);

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(todayDate);
      date.setUTCDate(todayDate.getUTCDate() - (6 - index));
      const dateKey = dateKeyFromUtcDate(date);
      const volume = records
        .filter((record) => record.workoutDate === dateKey)
        .reduce((sum, record) => sum + record.volumeKg, 0);

      return {
        dateKey,
        label: new Intl.DateTimeFormat("ja-JP", {
          timeZone: "UTC",
          weekday: "short",
        }).format(date),
        volume,
      };
    });
  }, [records, today]);
  const maxDailyVolume = Math.max(...dailyData.map((day) => day.volume), 1);
  const sevenDayTotal = dailyData.reduce((sum, day) => sum + day.volume, 0);
  const bodyPartData = useMemo(
    () =>
      BODY_PARTS.map((bodyPart) => ({
        bodyPart,
        volume: records
          .filter((record) => record.bodyPart === bodyPart)
          .reduce((sum, record) => sum + record.volumeKg, 0),
      }))
        .filter((item) => item.volume > 0)
        .sort((a, b) => b.volume - a.volume),
    [records],
  );
  const maxBodyPartVolume = Math.max(
    ...bodyPartData.map((item) => item.volume),
    1,
  );
  const exerciseData = useMemo(() => {
    const totals = new Map<string, { name: string; volume: number }>();

    for (const record of records) {
      const current = totals.get(record.exerciseId);
      totals.set(
        record.exerciseId,
        {
          name: record.exerciseName,
          volume: (current?.volume ?? 0) + record.volumeKg,
        },
      );
    }

    return [...totals.entries()]
      .map(([id, item]) => ({ id, ...item }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);
  }, [records]);

  return (
    <main className="app-page">
      <div className="app-container">
        <PageHeading
          eyebrow="積み重ね"
          title="履歴分析"
          description="まずは7日間の負荷量と、鍛えた部位の偏りを確認できます。"
        />
        <StorageNotice />

        {!isReady ? (
          <div className="surface-panel h-72 animate-pulse rounded-xl" />
        ) : records.length === 0 ? (
          <section className="surface-panel rounded-xl px-6 py-14 text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-accent-soft text-accent">
              <BarChart3 aria-hidden="true" size={28} />
            </span>
            <h2 className="mt-5 text-xl font-semibold">最初の記録を待っています</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
              トレーニングを1件保存すると、負荷量と部位別の集計がここに表示されます。
            </p>
            <Link
              href={`/records/new?date=${today}`}
              className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-bold text-white"
            >
              <Dumbbell aria-hidden="true" size={18} />
              記録を追加
            </Link>
          </section>
        ) : (
          <div className="grid gap-5">
            <section className="surface-panel rounded-xl p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold text-muted">直近7日間</p>
                  <h2 className="mt-1 text-lg font-semibold">トータルボリューム</h2>
                </div>
                <div className="text-right">
                  <p className="data-number text-2xl font-bold">
                    {formatVolume(sevenDayTotal)}
                  </p>
                  <p className="mt-1 text-[11px] font-bold text-muted">7日合計</p>
                </div>
              </div>

              <div
                className="mt-7 grid h-52 grid-cols-7 items-end gap-2 border-b border-line px-1"
                role="img"
                aria-label="直近7日間のトータルボリューム棒グラフ"
              >
                {dailyData.map((day) => {
                  const height = day.volume
                    ? Math.max(8, (day.volume / maxDailyVolume) * 100)
                    : 2;
                  return (
                    <div
                      key={day.dateKey}
                      className="flex h-full min-w-0 flex-col justify-end gap-2"
                      title={`${day.dateKey}: ${formatVolume(day.volume)}`}
                    >
                      <div
                        className={`mx-auto w-full max-w-10 rounded-t-xl ${
                          day.volume > 0 ? "bg-accent" : "bg-line"
                        }`}
                        style={{ height: `${height}%` }}
                      />
                      <span className="pb-2 text-center text-[11px] font-bold text-muted">
                        {day.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <ul className="sr-only">
                {dailyData.map((day) => (
                  <li key={day.dateKey}>
                    {day.dateKey}: {formatVolume(day.volume)}
                  </li>
                ))}
              </ul>
            </section>

            <section className="surface-panel rounded-xl p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-muted">全期間</p>
                  <h2 className="mt-1 text-lg font-semibold">部位別の負荷量</h2>
                </div>
                <TrendingUp aria-hidden="true" className="text-accent" size={22} />
              </div>
              <ul className="mt-6 space-y-4">
                {bodyPartData.map((item) => (
                  <li key={item.bodyPart}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs font-bold">
                      <span>{BODY_PART_LABELS[item.bodyPart]}</span>
                      <span className="font-mono">{formatVolume(item.volume)}</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-canvas">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{
                          width: `${Math.max(5, (item.volume / maxBodyPartVolume) * 100)}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="surface-panel rounded-xl p-5 sm:p-6">
              <p className="text-xs font-bold text-muted">全期間</p>
              <h2 className="mt-1 text-lg font-semibold">種目別ボリューム</h2>
              <ol className="mt-5 divide-y divide-line">
                {exerciseData.map((item, index) => (
                  <li key={item.id} className="flex items-center gap-4 py-4">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink font-mono text-xs font-black text-white">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-bold">{item.name}</span>
                    <span className="data-number shrink-0 font-black">
                      {formatVolume(item.volume)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
