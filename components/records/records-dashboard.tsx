"use client";

import {
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Plus,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PageHeading } from "@/components/common/page-heading";
import { StorageNotice } from "@/components/common/storage-notice";
import { useDemoData } from "@/components/providers/demo-data-provider";
import {
  buildMonthGrid,
  dateKeyInTimeZone,
  formatJapaneseDate,
  formatJapaneseMonth,
  parseDateKey,
  shiftMonth,
} from "@/lib/domain/date";
import {
  BODY_PART_LABELS,
  formatVolume,
  formatWeight,
  type WeightUnit,
} from "@/lib/domain/workout";

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

export function RecordsDashboard({
  initialDate,
  showSavedMessage,
}: {
  initialDate: string;
  showSavedMessage: boolean;
}) {
  const { records, settings, updateSettings, isReady } = useDemoData();
  const initialDateObject = parseDateKey(initialDate);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [view, setView] = useState({
    year: initialDateObject.getUTCFullYear(),
    monthIndex: initialDateObject.getUTCMonth(),
  });
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const calendarDays = useMemo(
    () => buildMonthGrid(view.year, view.monthIndex),
    [view.monthIndex, view.year],
  );
  const recordDates = useMemo(
    () => new Set(records.map((record) => record.workoutDate)),
    [records],
  );
  const selectedRecords = useMemo(
    () =>
      records
        .filter((record) => record.workoutDate === selectedDate)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [records, selectedDate],
  );
  const selectedTotal = selectedRecords.reduce(
    (sum, record) => sum + record.volumeKg,
    0,
  );
  const today = dateKeyInTimeZone();

  function moveMonth(amount: number) {
    setView((current) => shiftMonth(current.year, current.monthIndex, amount));
  }

  function selectDate(dateKey: string) {
    if (dateKey > today) {
      return;
    }

    setSelectedDate(dateKey);
    const date = parseDateKey(dateKey);
    setView({ year: date.getUTCFullYear(), monthIndex: date.getUTCMonth() });
    window.history.replaceState(null, "", `/records?date=${dateKey}`);
  }

  function saveSettings(defaultSets: number, weightUnit: WeightUnit) {
    const result = updateSettings({ defaultSets, weightUnit });
    setSettingsMessage(
      result.ok ? "次の記録から設定を反映します。" : result.message,
    );
  }

  return (
    <main className="app-page">
      <div className="app-container">
        <PageHeading
          eyebrow="Training log"
          title="記録"
          description="日付を選ぶと、その日のトレーニングを確認できます。"
          action={
            <details className="relative">
              <summary
                aria-label="記録の設定を開く"
                className="grid size-12 cursor-pointer list-none place-items-center rounded-full border border-line bg-surface text-ink [&::-webkit-details-marker]:hidden"
              >
                <Settings2 aria-hidden="true" size={20} />
              </summary>
              <div className="surface-panel absolute top-14 right-0 z-20 w-[min(86vw,330px)] rounded-3xl p-5">
                <p className="text-sm font-black">記録の設定</p>
                <label className="mt-4 block text-xs font-bold text-muted">
                  デフォルトセット数
                  <select
                    value={settings.defaultSets}
                    onChange={(event) =>
                      saveSettings(Number(event.target.value), settings.weightUnit)
                    }
                    className="mt-2 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-ink"
                  >
                    {Array.from({ length: 10 }, (_, index) => index + 1).map(
                      (value) => (
                        <option key={value} value={value}>
                          {value}セット
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <fieldset className="mt-4">
                  <legend className="text-xs font-bold text-muted">重量単位</legend>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(["kg", "lb"] as const).map((unit) => (
                      <button
                        key={unit}
                        type="button"
                        aria-pressed={settings.weightUnit === unit}
                        onClick={() => saveSettings(settings.defaultSets, unit)}
                        className={`min-h-11 rounded-xl border text-sm font-black ${
                          settings.weightUnit === unit
                            ? "border-ink bg-ink text-white"
                            : "border-line bg-white text-muted"
                        }`}
                      >
                        {unit}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <dl className="mt-5 space-y-2 border-t border-line pt-4 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">app Ver</dt>
                    <dd className="font-mono font-bold">
                      {process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">保存先</dt>
                    <dd className="font-bold">この端末（プレビュー）</dd>
                  </div>
                </dl>
                {settingsMessage ? (
                  <p aria-live="polite" className="mt-3 text-xs font-bold text-muted">
                    {settingsMessage}
                  </p>
                ) : null}
              </div>
            </details>
          }
        />

        <StorageNotice />

        {showSavedMessage ? (
          <div
            role="status"
            className="mb-5 flex items-center gap-3 rounded-2xl border border-lime bg-lime/35 px-4 py-3 text-sm font-bold"
          >
            <CalendarCheck2 aria-hidden="true" size={18} />
            トレーニングを保存しました。
          </div>
        ) : null}

        <div className="grid items-start gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="surface-panel rounded-[30px] p-4 sm:p-6" aria-label="記録カレンダー">
            <div className="mb-5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => moveMonth(-1)}
                aria-label="前の月を表示"
                className="grid size-11 place-items-center rounded-full border border-line bg-white"
              >
                <ChevronLeft aria-hidden="true" size={19} />
              </button>
              <h2 className="text-lg font-black tracking-[-0.03em]">
                {formatJapaneseMonth(view.year, view.monthIndex)}
              </h2>
              <button
                type="button"
                onClick={() => moveMonth(1)}
                aria-label="次の月を表示"
                className="grid size-11 place-items-center rounded-full border border-line bg-white"
              >
                <ChevronRight aria-hidden="true" size={19} />
              </button>
            </div>

            <div className="grid grid-cols-7 text-center text-[11px] font-black text-muted">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="py-2">
                  {weekday}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day) => {
                const selected = day.dateKey === selectedDate;
                const isToday = day.dateKey === today;
                const hasRecord = recordDates.has(day.dateKey);
                const disabled = day.dateKey > today;

                return (
                  <button
                    key={day.dateKey}
                    type="button"
                    onClick={() => selectDate(day.dateKey)}
                    disabled={disabled}
                    aria-label={`${day.dateKey}${hasRecord ? "、記録あり" : ""}`}
                    aria-pressed={selected}
                    className={`relative grid aspect-square min-h-10 place-items-center rounded-xl text-sm font-bold transition-colors ${
                      selected
                        ? "bg-ink text-white"
                        : isToday
                          ? "bg-lime text-ink"
                          : day.isCurrentMonth
                            ? "text-ink hover:bg-canvas"
                            : "bg-canvas/35 text-muted hover:bg-canvas"
                    } disabled:cursor-not-allowed disabled:opacity-25`}
                  >
                    {day.day}
                    {hasRecord ? (
                      <span
                        aria-hidden="true"
                        className={`absolute bottom-1.5 size-1.5 rounded-full ${
                          selected ? "bg-accent" : "bg-accent-strong"
                        }`}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => selectDate(today)}
              className="mt-4 min-h-10 rounded-xl px-3 text-xs font-black text-accent-strong hover:bg-canvas"
            >
              今日に戻る
            </button>
          </section>

          <section aria-labelledby="selected-date-heading">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-muted">選択日</p>
                <h2 id="selected-date-heading" className="mt-1 text-xl font-black">
                  {formatJapaneseDate(selectedDate)}
                </h2>
              </div>
              <Link
                href={`/records/new?date=${encodeURIComponent(selectedDate)}`}
                className="flex min-h-11 items-center gap-2 rounded-full bg-accent-strong px-4 text-sm font-black text-white"
              >
                <Plus aria-hidden="true" size={17} />
                追加
              </Link>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-2xl bg-ink px-5 py-4 text-white">
              <span className="text-xs font-bold text-aqua">この日の合計</span>
              <span className="data-number text-xl font-black">
                {formatVolume(selectedTotal)}
              </span>
            </div>

            {!isReady ? (
              <div className="surface-panel animate-pulse rounded-[26px] p-6">
                <div className="h-4 w-28 rounded bg-line" />
                <div className="mt-4 h-8 w-44 rounded bg-line" />
              </div>
            ) : selectedRecords.length === 0 ? (
              <div className="surface-panel rounded-[28px] px-6 py-10 text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-full bg-canvas text-muted">
                  <Dumbbell aria-hidden="true" size={24} />
                </span>
                <h3 className="mt-4 font-black">まだ記録がありません</h3>
                <p className="mt-2 text-sm leading-6 text-muted">
                  種目を追加して、この日のトレーニングを残しましょう。
                </p>
                <Link
                  href={`/records/new?date=${encodeURIComponent(selectedDate)}`}
                  className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-5 text-sm font-black text-white"
                >
                  <Plus aria-hidden="true" size={17} />
                  記録を追加
                </Link>
              </div>
            ) : (
              <ul className="space-y-3">
                {selectedRecords.map((record, index) => (
                  <li
                    key={record.id}
                    className="surface-panel rounded-[24px] px-5 py-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-accent-strong">
                          {BODY_PART_LABELS[record.bodyPart]} · {index + 1}
                        </p>
                        <h3 className="mt-1 truncate text-lg font-black">
                          {record.exerciseName}
                        </h3>
                      </div>
                      <p className="data-number shrink-0 text-lg font-black">
                        {formatVolume(record.volumeKg)}
                      </p>
                    </div>
                    <p className="mt-3 text-sm font-bold text-muted">
                      {formatWeight(record.weightKg, settings.weightUnit)} × {record.reps}回 × {record.sets}セット
                    </p>
                    {record.memo ? (
                      <p className="mt-3 border-t border-line pt-3 text-sm leading-6 text-ink/80">
                        {record.memo}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
