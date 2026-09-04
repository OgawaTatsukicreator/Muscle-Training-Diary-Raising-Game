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
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { StorageNotice } from "@/components/common/storage-notice";
import { useAppData } from "@/components/providers/app-data-provider";
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
  initialView,
  showSavedMessage,
}: {
  initialDate: string;
  initialView: "calendar" | "day";
  showSavedMessage: boolean;
}) {
  const router = useRouter();
  const { records, settings, updateSettings, isReady, storageMode } = useAppData();
  const savingSettingsRef = useRef(false);
  const initialDateObject = parseDateKey(initialDate);
  const [screen, setScreen] = useState<"calendar" | "day">(initialView);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [view, setView] = useState({
    year: initialDateObject.getUTCFullYear(),
    monthIndex: initialDateObject.getUTCMonth(),
  });
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
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
  const selectedSets = selectedRecords.reduce(
    (sum, record) => sum + record.sets,
    0,
  );
  const selectedReps = selectedRecords.reduce(
    (sum, record) => sum + record.reps * record.sets,
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
    setScreen("day");
    router.replace(`/records?date=${encodeURIComponent(dateKey)}`, {
      scroll: false,
    });
  }

  function showCalendar() {
    setScreen("calendar");
    router.replace("/records", { scroll: false });
  }

  async function saveSettings(defaultSets: number, weightUnit: WeightUnit) {
    if (savingSettingsRef.current) {
      return;
    }

    savingSettingsRef.current = true;
    setIsSavingSettings(true);
    const result = await updateSettings({ defaultSets, weightUnit });
    savingSettingsRef.current = false;
    setIsSavingSettings(false);
    setSettingsMessage(
      result.ok ? "次の記録から設定を反映します。" : result.message,
    );
  }

  return (
    <main className="app-page">
      <div className="app-container">
        <StorageNotice />

        {screen === "calendar" ? (
          <>
            <header className="flex items-center justify-between gap-4 border-b border-line pb-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                  <Dumbbell aria-hidden="true" size={19} />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold tracking-[0.12em] text-muted uppercase">
                    Training log
                  </p>
                  <h1 className="truncate text-xl font-semibold tracking-[-0.03em]">
                    筋トレMEMO
                  </h1>
                </div>
              </div>

              <details className="relative">
                <summary
                  aria-label="記録の設定を開く"
                  className="grid size-11 cursor-pointer list-none place-items-center rounded-full border border-line bg-white text-ink [&::-webkit-details-marker]:hidden"
                >
                  <Settings2 aria-hidden="true" size={19} />
                </summary>
                <div className="memo-sheet !top-14 !right-0 !bottom-auto !left-auto w-[min(86vw,330px)] p-5">
                  <p className="text-base font-semibold">記録の設定</p>
                  <label className="mt-4 block text-xs font-bold text-ink/65">
                    デフォルトセット数
                    <select
                      value={settings.defaultSets}
                      disabled={!isReady || isSavingSettings}
                      onChange={(event) =>
                        saveSettings(Number(event.target.value), settings.weightUnit)
                      }
                      className="mt-2 min-h-12 w-full rounded-xl border border-ink/20 bg-white/65 px-3 text-sm font-bold text-ink disabled:cursor-wait disabled:text-muted"
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
                    <legend className="text-xs font-bold text-ink/65">重量単位</legend>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {(["kg", "lb"] as const).map((unit) => (
                        <button
                          key={unit}
                          type="button"
                          aria-pressed={settings.weightUnit === unit}
                          disabled={!isReady || isSavingSettings}
                          onClick={() => saveSettings(settings.defaultSets, unit)}
                          className={`min-h-11 rounded-xl border text-sm font-bold ${
                            settings.weightUnit === unit
                              ? "border-accent bg-accent text-white"
                              : "border-ink/20 bg-white/55 text-ink/65"
                          }`}
                        >
                          {unit}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <dl className="mt-5 space-y-2 border-t border-ink/15 pt-4 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">app Ver</dt>
                      <dd className="font-mono font-bold">
                        {process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">保存先</dt>
                      <dd className="font-bold">
                        {storageMode === "supabase"
                          ? "Supabase（アカウント）"
                          : storageMode === "loading"
                            ? "接続を確認中"
                            : storageMode === "local"
                              ? "この端末（プレビュー）"
                              : "再ログインが必要"}
                      </dd>
                    </div>
                  </dl>
                  {settingsMessage ? (
                    <p aria-live="polite" className="mt-3 text-xs font-bold">
                      {settingsMessage}
                    </p>
                  ) : null}
                </div>
              </details>
            </header>

            <section className="mt-6" aria-label="記録カレンダー">
              <div className="mb-5 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => moveMonth(-1)}
                  aria-label="前の月を表示"
                  className="grid size-11 place-items-center rounded-full border border-line bg-white hover:bg-canvas"
                >
                  <ChevronLeft aria-hidden="true" size={19} />
                </button>
                <h2
                  aria-live="polite"
                  className="text-lg font-semibold tracking-[-0.03em]"
                >
                  {formatJapaneseMonth(view.year, view.monthIndex)}
                </h2>
                <button
                  type="button"
                  onClick={() => moveMonth(1)}
                  aria-label="次の月を表示"
                  className="grid size-11 place-items-center rounded-full border border-line bg-white hover:bg-canvas"
                >
                  <ChevronRight aria-hidden="true" size={19} />
                </button>
              </div>

              <div className="grid grid-cols-7 border-y border-line py-1 text-center text-[10px] font-bold text-muted">
                {WEEKDAYS.map((weekday) => (
                  <div key={weekday} className="py-2">
                    {weekday}
                  </div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-7 gap-1">
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
                      className={`relative grid h-11 min-w-0 place-items-center rounded-lg border text-sm font-bold transition-colors ${
                        selected
                          ? "border-accent bg-accent text-white"
                          : isToday
                            ? "border-accent bg-accent-soft text-accent-strong"
                            : day.isCurrentMonth
                              ? "border-transparent text-ink hover:border-line hover:bg-canvas"
                              : "border-transparent text-muted hover:bg-canvas"
                      } disabled:cursor-not-allowed disabled:opacity-20`}
                    >
                      {day.day}
                      {hasRecord ? (
                        <span
                          aria-hidden="true"
                          className={`absolute bottom-1 size-1.5 rounded-full ${
                            selected ? "bg-white" : "bg-accent"
                          }`}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <Link
                href={`/records/new?date=${today}`}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-white shadow-[0_4px_0_var(--accent-shadow)] active:translate-y-1 active:shadow-none"
              >
                <Plus aria-hidden="true" size={18} />
                今日のトレーニングを追加
              </Link>
              <button
                type="button"
                onClick={() => selectDate(today)}
                className="min-h-12 rounded-xl border border-line bg-white px-4 text-sm font-bold hover:bg-canvas"
              >
                今日の記録を見る
              </button>
            </div>
          </>
        ) : (
          <>
            <header className="grid grid-cols-[44px_1fr_auto] items-center gap-3 border-b border-line pb-4">
              <button
                type="button"
                onClick={showCalendar}
                aria-label="カレンダーへ戻る"
                className="grid size-11 place-items-center rounded-full border border-line bg-white hover:bg-canvas"
              >
                <ChevronLeft aria-hidden="true" size={20} />
              </button>
              <div className="min-w-0 text-center">
                <p className="text-[10px] font-bold tracking-[0.1em] text-muted uppercase">
                  Training log
                </p>
                <h1 className="truncate text-base font-semibold sm:text-lg">
                  {formatJapaneseDate(selectedDate)}
                </h1>
              </div>
              <Link
                href={`/records/new?date=${encodeURIComponent(selectedDate)}`}
                aria-label="この日にトレーニングを追加"
                className="grid size-11 place-items-center rounded-full bg-accent text-white"
              >
                <Plus aria-hidden="true" size={20} />
              </Link>
            </header>

            {showSavedMessage ? (
              <div
                role="status"
                className="mt-4 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm font-bold"
              >
                <CalendarCheck2 aria-hidden="true" size={18} />
                トレーニングを保存しました。
              </div>
            ) : null}

            <dl className="mt-5 grid grid-cols-2 gap-2 min-[360px]:grid-cols-4">
              {[
                ["合計種目数", selectedRecords.length.toLocaleString("ja-JP")],
                ["合計セット数", selectedSets.toLocaleString("ja-JP")],
                ["合計回数", selectedReps.toLocaleString("ja-JP")],
                ["合計ボリューム", formatVolume(selectedTotal)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="min-w-0 rounded-lg border border-line bg-white px-1.5 py-3 text-center"
                >
                  <dt className="text-[10px] leading-4 font-bold text-muted">{label}</dt>
                  <dd className="data-number mt-1 break-words text-xs font-bold sm:text-sm">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            {!isReady ? (
              <div className="mt-5 h-72 animate-pulse rounded-xl border border-line bg-canvas" />
            ) : selectedRecords.length === 0 ? (
              <section className="mt-5 grid min-h-[330px] place-items-center rounded-xl border border-dashed border-line p-7 text-center">
                <div>
                  <span className="mx-auto grid size-14 place-items-center rounded-full bg-accent-soft text-accent">
                    <Dumbbell aria-hidden="true" size={23} />
                  </span>
                  <h2 className="mt-4 text-lg font-semibold">まだ記録がありません</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    種目を選んで、この日のトレーニングを残しましょう。
                  </p>
                  <Link
                    href={`/records/new?date=${encodeURIComponent(selectedDate)}`}
                    className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-bold text-white"
                  >
                    <Plus aria-hidden="true" size={17} />
                    この日に記録を追加
                  </Link>
                </div>
              </section>
            ) : (
              <ul className="mt-5 space-y-3">
                {selectedRecords.map((record, index) => (
                  <li key={record.id} className="rounded-xl border border-line bg-white p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold text-accent-strong">
                          {BODY_PART_LABELS[record.bodyPart]} · {index + 1}
                        </p>
                        <h2 className="mt-1 truncate text-base font-semibold">
                          {record.exerciseName}
                        </h2>
                      </div>
                      <p className="data-number shrink-0 text-base font-bold">
                        {formatVolume(record.volumeKg)}
                      </p>
                    </div>
                    <p className="mt-3 text-sm font-bold text-muted">
                      {formatWeight(record.weightKg, settings.weightUnit)} × {record.reps}回 × {record.sets}セット
                    </p>
                    {record.memo ? (
                      <p className="mt-3 border-t border-line pt-3 text-sm leading-6 text-ink/75">
                        {record.memo}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <Link
              href={`/records/new?date=${encodeURIComponent(selectedDate)}`}
              className="mt-5 flex min-h-12 items-center justify-center gap-2 rounded-xl border border-ink bg-white px-5 text-sm font-bold hover:bg-canvas"
            >
              <Plus aria-hidden="true" size={18} />
              この日にもう1種目追加
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
