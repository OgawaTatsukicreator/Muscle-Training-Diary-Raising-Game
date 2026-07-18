"use client";

import {
  Beef,
  ChevronRight,
  Dumbbell,
  LogIn,
  Menu,
  PencilLine,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

import { PageHeading } from "@/components/common/page-heading";
import { StorageNotice } from "@/components/common/storage-notice";
import { useDemoData } from "@/components/providers/demo-data-provider";
import { formatJapaneseDate } from "@/lib/domain/date";
import { requiredExperienceForLevel } from "@/lib/domain/growth";
import { formatVolume } from "@/lib/domain/workout";

export function HomeDashboard({ today }: { today: string }) {
  const {
    records,
    maso,
    feedMaso,
    renameMaso,
    clearLocalData,
    isReady,
  } = useDemoData();
  const [message, setMessage] = useState<string | null>(null);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const name = nameOverride ?? maso.name;
  const todayRecords = useMemo(
    () => records.filter((record) => record.workoutDate === today),
    [records, today],
  );
  const todayVolume = todayRecords.reduce(
    (sum, record) => sum + record.volumeKg,
    0,
  );
  const requiredExperience = requiredExperienceForLevel(maso.level);
  const progress = Math.min(100, (maso.experience / requiredExperience) * 100);

  function handleFeed() {
    const result = feedMaso(1);
    setMessage(result.ok ? "もぐもぐ。経験値が10増えました。" : result.message);
  }

  function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = renameMaso(name);
    if (result.ok) {
      setNameOverride(null);
    }
    setMessage(result.ok ? `${result.data.name}に名前を変更しました。` : result.message);
  }

  if (!isReady) {
    return (
      <main className="app-page" aria-busy="true" aria-label="ホームを読み込み中">
        <div className="app-container">
          <PageHeading
            eyebrow="Today / 育成日記"
            title="今日も、一段つよく。"
            description={formatJapaneseDate(today)}
          />
          <section className="surface-panel animate-pulse rounded-[34px] p-6">
            <div className="mx-auto aspect-square w-full max-w-72 rounded-full bg-line" />
            <div className="mx-auto mt-7 h-8 w-40 rounded-xl bg-line" />
            <div className="mt-5 h-4 rounded-full bg-line" />
            <div className="mt-5 h-24 rounded-2xl bg-canvas" />
          </section>
          <span className="sr-only">端末の記録を読み込んでいます</span>
        </div>
      </main>
    );
  }

  return (
    <main className="app-page">
      <div className="app-container">
        <PageHeading
          eyebrow="Today / 育成日記"
          title="今日も、一段つよく。"
          description={formatJapaneseDate(today)}
          action={
            <details className="relative">
              <summary
                aria-label="メニューを開く"
                className="grid size-12 cursor-pointer list-none place-items-center rounded-full border border-line bg-surface text-ink shadow-sm transition-colors hover:bg-white [&::-webkit-details-marker]:hidden"
              >
                <Menu aria-hidden="true" size={21} />
              </summary>
              <div className="surface-panel absolute top-14 right-0 z-20 w-[min(82vw,300px)] rounded-3xl p-4">
                <p className="mb-3 text-xs font-black tracking-[0.14em] text-muted uppercase">
                  メニュー
                </p>
                <form onSubmit={handleRename} className="mb-4">
                  <label htmlFor="maso-name" className="mb-2 block text-sm font-bold">
                    マソ君の名前
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="maso-name"
                      value={name}
                      onChange={(event) => setNameOverride(event.target.value)}
                      maxLength={30}
                      className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      aria-label="名前を保存"
                      className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink text-white"
                    >
                      <PencilLine aria-hidden="true" size={17} />
                    </button>
                  </div>
                </form>
                <Link
                  href="/login"
                  className="flex min-h-11 items-center gap-3 border-t border-line py-3 text-sm font-bold"
                >
                  <LogIn aria-hidden="true" size={17} />
                  ログイン設定
                </Link>
                {isConfirmingClear ? (
                  <div className="border-t border-line pt-3">
                    <p role="alert" className="text-xs leading-5 font-bold text-accent-strong">
                      この端末の記録・設定・育成状態がすべて消えます。
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setIsConfirmingClear(false)}
                        className="min-h-10 rounded-xl border border-line bg-white text-xs font-black"
                      >
                        やめる
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const result = clearLocalData();
                          if (result.ok) {
                            setNameOverride(null);
                            setIsConfirmingClear(false);
                          }
                          setMessage(
                            result.ok
                              ? "端末内のプレビューデータを消去しました。"
                              : result.message,
                          );
                        }}
                        className="min-h-10 rounded-xl bg-accent-strong px-2 text-xs font-black text-white"
                      >
                        すべて消去
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsConfirmingClear(true)}
                    className="flex min-h-11 w-full items-center gap-3 border-t border-line py-3 text-left text-sm font-bold text-muted"
                  >
                    <RotateCcw aria-hidden="true" size={17} />
                    プレビューデータを消去
                  </button>
                )}
              </div>
            </details>
          }
        />

        <StorageNotice />

        <section className="surface-panel overflow-hidden rounded-[34px] p-5 sm:p-8">
          <div className="grid items-center gap-8 md:grid-cols-[0.9fr_1.1fr]">
            <div className="flex justify-center">
              <div className="plate-stage">
                <span className="absolute top-5 rounded-full bg-ink px-3 py-1 font-mono text-xs font-bold text-white">
                  LV. {maso.level}
                </span>
                <Image
                  className="maso-float mt-8 h-auto w-[72%]"
                  src="/maso/maso-level-1.svg"
                  alt={`レベル${maso.level}の${maso.name}`}
                  width={320}
                  height={320}
                  preload
                />
              </div>
            </div>

            <div>
              <div className="flex items-end justify-between gap-4 border-b border-line pb-4">
                <div>
                  <p className="text-xs font-bold text-muted">育成中</p>
                  <h2 className="mt-1 text-3xl font-black tracking-[-0.05em]">
                    {maso.name}
                  </h2>
                </div>
                <Sparkles aria-hidden="true" className="text-accent" size={28} />
              </div>

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-xs font-bold">
                  <span>次のレベルまで</span>
                  <span className="font-mono">
                    {maso.experience} / {requiredExperience} XP
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="マソ君の経験値"
                  aria-valuemin={0}
                  aria-valuemax={requiredExperience}
                  aria-valuenow={maso.experience}
                  className="h-4 overflow-hidden rounded-full border-2 border-ink bg-white"
                >
                  <div
                    className="h-full rounded-full bg-lime transition-[width] duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              <dl className="mt-6 grid grid-cols-2 divide-x divide-line rounded-2xl border border-line bg-canvas/60 py-4">
                <div className="px-4">
                  <dt className="flex items-center gap-2 text-xs font-bold text-muted">
                    <Sparkles aria-hidden="true" size={15} />
                    育成ポイント
                  </dt>
                  <dd className="data-number mt-2 text-2xl font-black">
                    {maso.growthPoints.toLocaleString("ja-JP")}
                  </dd>
                </div>
                <div className="px-4">
                  <dt className="flex items-center gap-2 text-xs font-bold text-muted">
                    <Beef aria-hidden="true" size={15} />
                    エサ
                  </dt>
                  <dd className="data-number mt-2 text-2xl font-black">
                    {maso.food.toLocaleString("ja-JP")}
                  </dd>
                </div>
              </dl>

              <button
                type="button"
                onClick={handleFeed}
                disabled={!isReady || maso.food < 1}
                className="mt-5 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-accent-strong px-5 py-3 font-black text-white shadow-[0_6px_0_var(--accent-shadow)] transition-transform hover:-translate-y-0.5 active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:bg-line disabled:text-muted disabled:shadow-none"
              >
                <Beef aria-hidden="true" size={20} />
                {maso.food > 0 ? "エサを1個あげる" : "記録してエサを獲得"}
              </button>
              {message ? (
                <p aria-live="polite" className="mt-3 text-center text-sm font-bold text-muted">
                  {message}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <Link
            href={`/records/new?date=${today}`}
            className="group flex min-h-28 items-center justify-between rounded-[28px] bg-ink px-6 py-5 text-white shadow-lg transition-transform hover:-translate-y-0.5"
          >
            <div>
              <p className="text-xs font-bold text-aqua">今日のトレーニング</p>
              <p className="mt-2 text-xl font-black">記録を追加</p>
            </div>
            <span className="grid size-12 place-items-center rounded-full bg-accent">
              <Dumbbell aria-hidden="true" size={22} />
            </span>
          </Link>

          <Link
            href={`/records?date=${today}`}
            className="flex min-h-28 items-center justify-between rounded-[28px] border border-line bg-surface px-6 py-5 transition-colors hover:bg-white"
          >
            <div>
              <p className="text-xs font-bold text-muted">今日の合計</p>
              <p className="data-number mt-2 text-2xl font-black">
                {formatVolume(todayVolume)}
              </p>
              <p className="mt-1 text-xs font-bold text-muted">
                {todayRecords.length} 種目
              </p>
            </div>
            <ChevronRight aria-hidden="true" className="text-muted" size={20} />
          </Link>
        </section>
      </div>
    </main>
  );
}
