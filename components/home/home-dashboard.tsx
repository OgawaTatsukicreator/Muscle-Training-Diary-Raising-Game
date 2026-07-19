"use client";

import {
  Beef,
  LogIn,
  Menu,
  PencilLine,
  RotateCcw,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { StorageNotice } from "@/components/common/storage-notice";
import { useDemoData } from "@/components/providers/demo-data-provider";
import { formatJapaneseDate } from "@/lib/domain/date";
import { requiredExperienceForLevel } from "@/lib/domain/growth";

type HomePanel = "feed" | "menu" | null;

export function HomeDashboard({ today }: { today: string }) {
  const {
    records,
    maso,
    feedMaso,
    renameMaso,
    clearLocalData,
    isReady,
  } = useDemoData();
  const panelDialogRef = useRef<HTMLDialogElement>(null);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusToClearRef = useRef(false);
  const [panel, setPanel] = useState<HomePanel>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const name = nameOverride ?? maso.name;
  const todayRecords = useMemo(
    () => records.filter((record) => record.workoutDate === today),
    [records, today],
  );
  const requiredExperience = requiredExperienceForLevel(maso.level);
  const progress = Math.min(100, (maso.experience / requiredExperience) * 100);

  useEffect(() => {
    const dialog = panelDialogRef.current;

    if (panel && dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [panel]);

  useEffect(() => {
    if (!isConfirmingClear && returnFocusToClearRef.current) {
      clearButtonRef.current?.focus();
      returnFocusToClearRef.current = false;
    }
  }, [isConfirmingClear]);

  function closePanel() {
    const dialog = panelDialogRef.current;

    if (dialog?.open) {
      dialog.close();
    } else {
      setPanel(null);
    }
  }

  function changePanel(nextPanel: HomePanel) {
    if (nextPanel === null) {
      closePanel();
      return;
    }

    setPanel(nextPanel);
    setMessage(null);
    setIsConfirmingClear(false);
  }

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
        <div className="app-container animate-pulse">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-3 w-32 rounded bg-line" />
              <div className="mt-3 h-8 w-40 rounded bg-line" />
            </div>
            <div className="size-12 rounded-full bg-line" />
          </div>
          <div className="mt-5 h-20 rounded-2xl bg-canvas" />
          <div className="mt-5 h-[430px] rounded-3xl bg-canvas" />
          <span className="sr-only">端末の記録を読み込んでいます</span>
        </div>
      </main>
    );
  }

  return (
    <main className="app-page">
      <div className="app-container">
        <StorageNotice />

        <section aria-labelledby="home-title">
          <header className="flex items-start justify-between gap-4 border-b border-line pb-4">
            <div>
              <p className="text-[11px] font-bold tracking-[0.12em] text-muted uppercase">
                {formatJapaneseDate(today)}
              </p>
              <h1 id="home-title" className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
                筋トレMEMO
              </h1>
            </div>
            <div className="rounded-full border border-accent bg-accent px-4 py-2 text-center text-white">
              <span className="block text-[9px] font-bold tracking-[0.14em] text-white">
                LEVEL
              </span>
              <span className="data-number text-lg font-bold">{maso.level}</span>
            </div>
          </header>

          <dl className="mt-4 grid grid-cols-3 divide-x divide-line rounded-2xl border border-line bg-canvas/35 py-3">
            <div className="px-3 text-center">
              <dt className="text-[10px] font-bold text-muted">育成ポイント</dt>
              <dd className="data-number mt-1 text-base font-bold">
                {maso.growthPoints.toLocaleString("ja-JP")}
              </dd>
            </div>
            <div className="px-3 text-center">
              <dt className="text-[10px] font-bold text-muted">エサ</dt>
              <dd className="data-number mt-1 text-base font-bold">
                {maso.food.toLocaleString("ja-JP")}
              </dd>
            </div>
            <div className="px-3 text-center">
              <dt className="text-[10px] font-bold text-muted">今日の種目</dt>
              <dd className="data-number mt-1 text-base font-bold">
                {todayRecords.length}
              </dd>
            </div>
          </dl>

          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold text-muted">
              <span>{maso.name}の経験値</span>
              <span className="font-mono">
                {maso.experience} / {requiredExperience} XP
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={`${maso.name}の経験値`}
              aria-valuemin={0}
              aria-valuemax={requiredExperience}
              aria-valuenow={maso.experience}
              className="h-2.5 overflow-hidden rounded-full border border-ink bg-white"
            >
              <div
                className="h-full bg-accent transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="maso-scene mt-2">
            <div className="maso-halo" aria-hidden="true" />
            <p className="maso-speech" aria-live="polite">
              {panel === null && message ? message : "今日も一緒に頑張ろう"}
            </p>

            <Image
              className="maso-float relative z-[2] mt-16 h-auto w-[62%] max-w-[310px]"
              src="/maso/maso-level-1.svg"
              alt={`レベル${maso.level}の${maso.name}`}
              width={320}
              height={320}
              preload
            />

            <button
              type="button"
              onClick={() => changePanel("menu")}
              aria-expanded={panel === "menu"}
              aria-controls="home-menu-panel"
              className={`absolute top-[52%] left-0 z-[5] flex min-h-12 items-center gap-2 rounded-full border px-3.5 text-xs font-bold shadow-sm transition-colors ${
                panel === "menu"
                  ? "border-accent bg-accent text-white"
                  : "border-line-strong bg-white text-ink hover:bg-canvas"
              }`}
            >
              <Menu aria-hidden="true" size={17} />
              メニュー
            </button>

            <button
              type="button"
              onClick={() => changePanel("feed")}
              aria-expanded={panel === "feed"}
              aria-controls="home-feed-panel"
              className={`absolute top-[52%] right-0 z-[5] flex min-h-12 items-center gap-2 rounded-full border px-3.5 text-xs font-bold shadow-sm transition-colors ${
                panel === "feed"
                  ? "border-accent bg-accent text-white"
                  : "border-line-strong bg-white text-ink hover:bg-canvas"
              }`}
            >
              エサやり
              <Beef aria-hidden="true" size={17} />
            </button>

            {panel === "feed" ? (
              <dialog
                ref={panelDialogRef}
                id="home-feed-panel"
                aria-labelledby="feed-panel-title"
                className="home-panel-dialog"
                onClose={() => setPanel(null)}
              >
                <div className="home-dialog-sheet">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold tracking-[0.12em] text-muted uppercase">
                      エサやり
                    </p>
                    <h2 id="feed-panel-title" className="mt-1 text-lg font-semibold">
                      {maso.name}にエサをあげる
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={closePanel}
                    aria-label="エサやりを閉じる"
                    className="grid size-11 shrink-0 place-items-center rounded-full border border-ink/25 bg-white/45"
                  >
                    <X aria-hidden="true" size={18} />
                  </button>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-xl border border-ink/15 bg-white/35 px-4 py-3">
                  <span className="text-xs font-bold">持っているエサ</span>
                  <span className="data-number text-xl font-bold">{maso.food} 個</span>
                </div>
                <button
                  type="button"
                  onClick={handleFeed}
                  disabled={maso.food < 1}
                  className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 font-bold text-white disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
                >
                  <Beef aria-hidden="true" size={19} />
                  {maso.food > 0 ? "エサを1個あげる" : "記録してエサを獲得"}
                </button>
                {message ? (
                  <p aria-live="polite" className="mt-3 text-center text-xs font-bold">
                    {message}
                  </p>
                ) : null}
                </div>
              </dialog>
            ) : null}

            {panel === "menu" ? (
              <dialog
                ref={panelDialogRef}
                id="home-menu-panel"
                aria-labelledby="menu-panel-title"
                className="home-panel-dialog"
                onClose={() => setPanel(null)}
              >
                <div className="home-dialog-sheet">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold tracking-[0.12em] text-muted uppercase">
                      設定
                    </p>
                    <h2 id="menu-panel-title" className="mt-1 text-lg font-semibold">
                      マソ君の設定
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={closePanel}
                    aria-label="メニューを閉じる"
                    className="grid size-11 shrink-0 place-items-center rounded-full border border-ink/25 bg-white/45"
                  >
                    <X aria-hidden="true" size={18} />
                  </button>
                </div>

                <form onSubmit={handleRename} className="mt-4">
                  <label htmlFor="maso-name" className="block text-xs font-bold">
                    名前の変更
                  </label>
                  <div className="mt-2 flex gap-2">
                    <input
                      id="maso-name"
                      value={name}
                      onChange={(event) => setNameOverride(event.target.value)}
                      maxLength={30}
                      className="min-h-11 min-w-0 flex-1 rounded-xl border border-ink/25 bg-white/65 px-3 text-sm"
                    />
                    <button
                      type="submit"
                      className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-accent px-4 text-xs font-bold text-white"
                    >
                      <PencilLine aria-hidden="true" size={15} />
                      保存
                    </button>
                  </div>
                </form>

                <Link
                  href="/login"
                  className="mt-4 flex min-h-11 items-center gap-3 border-t border-ink/15 pt-3 text-sm font-bold"
                >
                  <LogIn aria-hidden="true" size={17} />
                  ログイン設定
                </Link>

                {isConfirmingClear ? (
                  <div className="mt-2 border-t border-ink/15 pt-3">
                    <p role="alert" className="text-xs leading-5 font-bold text-accent-strong">
                      この端末の記録・設定・育成状態がすべて消えます。
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          returnFocusToClearRef.current = true;
                          setIsConfirmingClear(false);
                        }}
                        className="min-h-11 rounded-xl border border-ink/25 bg-white/55 text-xs font-bold"
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const result = clearLocalData();
                          if (result.ok) {
                            setNameOverride(null);
                            setIsConfirmingClear(false);
                            closePanel();
                          }
                          setMessage(
                            result.ok
                              ? "端末内のプレビューデータを消去しました。"
                              : result.message,
                          );
                        }}
                        className="min-h-11 rounded-xl bg-accent-strong px-2 text-xs font-bold text-white"
                      >
                        すべて消去
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    ref={clearButtonRef}
                    type="button"
                    onClick={() => setIsConfirmingClear(true)}
                    className="mt-2 flex min-h-11 w-full items-center gap-3 border-t border-ink/15 pt-3 text-left text-xs font-bold text-muted"
                  >
                    <RotateCcw aria-hidden="true" size={16} />
                    プレビューデータを消去
                  </button>
                )}
                {message ? (
                  <p aria-live="polite" className="mt-3 text-xs font-bold">
                    {message}
                  </p>
                ) : null}
                </div>
              </dialog>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
