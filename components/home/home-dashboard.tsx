"use client";

import {
  Beef,
  ChevronLeft,
  LogIn,
  Menu,
  Minus,
  PencilLine,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { StorageNotice } from "@/components/common/storage-notice";
import { useDemoData } from "@/components/providers/demo-data-provider";
import { formatJapaneseDate } from "@/lib/domain/date";
import {
  FOOD_ITEMS,
  masoImageForLevel,
  masoPhaseForLevel,
  requiredExperienceForLevel,
  type FoodKind,
} from "@/lib/domain/growth";

type HomePanel = "feed" | "menu" | null;
type FeedStep = "select" | "confirm";
type FeedMode = "exchange" | "feed";

export function HomeDashboard({ today }: { today: string }) {
  const {
    records,
    maso,
    exchangeGrowthPoints,
    feedMaso,
    renameMaso,
    clearLocalData,
    isReady,
  } = useDemoData();
  const panelDialogRef = useRef<HTMLDialogElement>(null);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusToClearRef = useRef(false);
  const previousLevelRef = useRef(maso.level);
  const hasObservedReadyLevelRef = useRef(false);
  const levelUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panel, setPanel] = useState<HomePanel>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [levelUpLevel, setLevelUpLevel] = useState<number | null>(null);
  const [feedStep, setFeedStep] = useState<FeedStep>("select");
  const [feedMode, setFeedMode] = useState<FeedMode>("exchange");
  const [selectedFoodKind, setSelectedFoodKind] =
    useState<FoodKind>("onigiri");
  const [feedAmount, setFeedAmount] = useState(1);
  const name = nameOverride ?? maso.name;
  const todayRecords = useMemo(
    () => records.filter((record) => record.workoutDate === today),
    [records, today],
  );
  const requiredExperience = requiredExperienceForLevel(maso.level);
  const progress = Math.min(100, (maso.experience / requiredExperience) * 100);
  const masoPhase = masoPhaseForLevel(maso.level);
  const masoImage = masoImageForLevel(maso.level);
  const selectedFood = FOOD_ITEMS[selectedFoodKind];
  const selectedFoodBalance =
    selectedFoodKind === "onigiri" ? maso.food : maso.protein;
  const totalFood = maso.food + maso.protein;

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

  useEffect(() => {
    if (!isReady) {
      return;
    }

    if (!hasObservedReadyLevelRef.current) {
      previousLevelRef.current = maso.level;
      hasObservedReadyLevelRef.current = true;
      return;
    }

    if (maso.level > previousLevelRef.current) {
      if (levelUpTimerRef.current) {
        clearTimeout(levelUpTimerRef.current);
      }

      setLevelUpLevel(maso.level);
      levelUpTimerRef.current = setTimeout(() => {
        setLevelUpLevel(null);
        levelUpTimerRef.current = null;
      }, 1600);
    }

    previousLevelRef.current = maso.level;
  }, [isReady, maso.level]);

  useEffect(
    () => () => {
      if (levelUpTimerRef.current) {
        clearTimeout(levelUpTimerRef.current);
      }
    },
    [],
  );

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

    if (nextPanel === "feed") {
      setFeedMode(totalFood > 0 ? "feed" : "exchange");
      setFeedStep("select");
      setFeedAmount(1);
    }
  }

  function handleFeed() {
    const result = feedMaso(selectedFoodKind, feedAmount);
    const didLevelUp = result.ok && result.data.level > maso.level;

    setMessage(
      result.ok
        ? didLevelUp
          ? `レベル${result.data.level}になりました！`
          : `もぐもぐ。${selectedFood.name}を${feedAmount}個あげて、経験値が${feedAmount * selectedFood.experience}増えました。`
        : result.message,
    );

    if (didLevelUp) {
      closePanel();
    } else if (result.ok) {
      setFeedStep("select");
      const nextBalance =
        selectedFoodKind === "onigiri" ? result.data.food : result.data.protein;
      setFeedAmount(Math.max(1, Math.min(feedAmount, nextBalance)));
    }
  }

  function changeFeedAmount(nextAmount: number) {
    if (selectedFoodBalance < 1) {
      setFeedAmount(1);
      return;
    }

    setFeedAmount(
      Math.min(selectedFoodBalance, Math.max(1, Math.floor(nextAmount))),
    );
    setMessage(null);
  }

  function chooseFood(kind: FoodKind) {
    setSelectedFoodKind(kind);
    setFeedAmount(1);
    setFeedStep("select");
    setMessage(null);
  }

  function handleExchange(kind: FoodKind) {
    const item = FOOD_ITEMS[kind];
    const result = exchangeGrowthPoints(kind);

    setMessage(
      result.ok
        ? `${item.name}1個と交換しました。`
        : result.message,
    );

    if (result.ok) {
      setSelectedFoodKind(kind);
    }
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
              <dt className="text-[10px] font-bold text-muted">アイテム</dt>
              <dd className="data-number mt-1 text-base font-bold">
                {totalFood.toLocaleString("ja-JP")}
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

            <div
              className={`maso-character relative z-[2] w-[62%] max-w-[310px] ${
                levelUpLevel !== null ? "is-leveling-up" : ""
              }`}
            >
              <Image
                className="maso-character-image h-auto w-full"
                src={masoImage}
                alt={`レベル${maso.level}の${maso.name}・体フェーズ${masoPhase}`}
                width={320}
                height={480}
                preload
              />
              <span className="maso-eye maso-eye--left" aria-hidden="true" />
              <span className="maso-eye maso-eye--right" aria-hidden="true" />
              <span className="maso-level-up-ring" aria-hidden="true" />
              {levelUpLevel !== null ? (
                <span className="maso-level-up-label" role="status">
                  <strong>LEVEL UP</strong>
                  <small>レベル {levelUpLevel}</small>
                </span>
              ) : null}
            </div>

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
                <div className="mt-4 grid grid-cols-2 rounded-xl bg-canvas p-1">
                  {(["exchange", "feed"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setFeedMode(mode);
                        setFeedStep("select");
                        setFeedAmount(1);
                        setMessage(null);
                      }}
                      aria-pressed={feedMode === mode}
                      className={`min-h-11 rounded-lg text-xs font-bold ${
                        feedMode === mode
                          ? "bg-white text-ink shadow-sm"
                          : "text-muted"
                      }`}
                    >
                      {mode === "exchange" ? "アイテム交換" : "エサをあげる"}
                    </button>
                  ))}
                </div>

                {feedMode === "exchange" ? (
                  <>
                    <div className="mt-4 flex items-center justify-between rounded-xl border border-ink/15 bg-white/35 px-4 py-3">
                      <span className="text-xs font-bold">使える育成ポイント</span>
                      <span className="data-number text-xl font-bold">
                        {maso.growthPoints.toLocaleString("ja-JP")} pt
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(Object.keys(FOOD_ITEMS) as FoodKind[]).map((kind) => {
                        const item = FOOD_ITEMS[kind];
                        const balance = kind === "onigiri" ? maso.food : maso.protein;
                        const canExchange =
                          maso.growthPoints >= item.growthPointCost;

                        return (
                          <div
                            key={kind}
                            className="rounded-xl border border-ink/15 bg-white/45 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-bold">{item.name}</p>
                                <p className="mt-1 text-xs text-muted">
                                  1個で +{item.experience} XP
                                </p>
                                <p className="mt-1 text-[11px] font-bold text-muted">
                                  所持 {balance}個
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleExchange(kind)}
                                disabled={!canExchange}
                                className="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
                              >
                                {item.growthPointCost} ptで交換
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-center text-[11px] text-muted">
                      トレーニング記録で育成ポイントが増えます。
                    </p>
                  </>
                ) : (
                  <>
                    <fieldset className="mt-4">
                      <legend className="text-xs font-bold">あげるアイテム</legend>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {(Object.keys(FOOD_ITEMS) as FoodKind[]).map((kind) => {
                          const item = FOOD_ITEMS[kind];
                          const balance = kind === "onigiri" ? maso.food : maso.protein;

                          return (
                            <button
                              key={kind}
                              type="button"
                              onClick={() => chooseFood(kind)}
                              aria-pressed={selectedFoodKind === kind}
                              className={`min-h-16 rounded-xl border px-3 text-left ${
                                selectedFoodKind === kind
                                  ? "border-accent bg-white"
                                  : "border-ink/15 bg-white/35"
                              }`}
                            >
                              <span className="block text-sm font-bold">{item.name}</span>
                              <span className="mt-1 block text-[11px] text-muted">
                                所持 {balance}個・+{item.experience} XP
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>

                    <div className="mt-3 flex items-center gap-2 text-[11px] font-bold">
                      <span className={`rounded-full px-3 py-1 ${feedStep === "select" ? "bg-accent text-white" : "bg-canvas text-muted"}`}>
                        1. 個数選択
                      </span>
                      <span aria-hidden="true" className="h-px flex-1 bg-line" />
                      <span className={`rounded-full px-3 py-1 ${feedStep === "confirm" ? "bg-accent text-white" : "bg-canvas text-muted"}`}>
                        2. 内容確認
                      </span>
                    </div>

                {feedStep === "select" ? (
                  <>
                    <fieldset className="mt-4">
                      <legend className="text-xs font-bold">あげる個数</legend>
                      <div className="mt-2 grid grid-cols-[48px_1fr_48px] gap-2">
                        <button
                          type="button"
                          onClick={() => changeFeedAmount(feedAmount - 1)}
                          disabled={selectedFoodBalance < 1 || feedAmount <= 1}
                          aria-label="エサを1個減らす"
                          className="grid min-h-12 place-items-center rounded-xl border border-ink/25 bg-white disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <Minus aria-hidden="true" size={18} />
                        </button>
                        <label className="relative">
                          <span className="sr-only">あげるエサの個数</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={Math.max(1, selectedFoodBalance)}
                            value={selectedFoodBalance > 0 ? feedAmount : 0}
                            onChange={(event) =>
                              changeFeedAmount(Number(event.target.value))
                            }
                            disabled={selectedFoodBalance < 1}
                            className="data-number min-h-12 w-full rounded-xl border border-ink/25 bg-white px-10 text-center text-xl font-bold disabled:bg-canvas disabled:text-muted"
                          />
                          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs font-bold text-muted">
                            個
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => changeFeedAmount(feedAmount + 1)}
                          disabled={selectedFoodBalance < 1 || feedAmount >= selectedFoodBalance}
                          aria-label="エサを1個増やす"
                          className="grid min-h-12 place-items-center rounded-xl border border-ink/25 bg-white disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <Plus aria-hidden="true" size={18} />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => changeFeedAmount(selectedFoodBalance)}
                        disabled={selectedFoodBalance < 1 || feedAmount === selectedFoodBalance}
                        className="mt-2 min-h-11 w-full rounded-xl border border-ink/25 bg-white text-xs font-bold disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        持っている{selectedFood.name}を全部選ぶ
                      </button>
                    </fieldset>

                    <button
                      type="button"
                      onClick={() => {
                        setFeedStep("confirm");
                        setMessage(null);
                      }}
                      disabled={selectedFoodBalance < 1}
                      className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-accent px-5 font-bold text-white disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
                    >
                      {selectedFoodBalance > 0 ? "この個数で確認" : "交換してからあげる"}
                    </button>
                  </>
                ) : (
                  <>
                    <dl className="mt-4 divide-y divide-line rounded-xl border border-ink/15 bg-white/45 px-4">
                      <div className="flex items-center justify-between py-3">
                        <dt className="text-xs font-bold text-muted">あげる個数</dt>
                        <dd className="data-number text-lg font-bold">
                          {feedAmount} 個
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-3">
                        <dt className="text-xs font-bold text-muted">獲得経験値</dt>
                        <dd className="data-number text-lg font-bold">
                          +{feedAmount * selectedFood.experience} XP
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-3">
                        <dt className="text-xs font-bold text-muted">使用後の残り</dt>
                        <dd className="data-number text-lg font-bold">
                          {Math.max(0, selectedFoodBalance - feedAmount)} 個
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4 grid grid-cols-[1fr_1.35fr] gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFeedStep("select");
                          setMessage(null);
                        }}
                        className="flex min-h-12 items-center justify-center gap-1 whitespace-nowrap rounded-xl border border-ink/25 bg-white px-2 text-[11px] font-bold"
                      >
                        <ChevronLeft aria-hidden="true" size={17} />
                        個数を変更
                      </button>
                      <button
                        type="button"
                        onClick={handleFeed}
                        className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-3 text-sm font-bold text-white"
                      >
                        <Beef aria-hidden="true" size={18} />
                        {selectedFood.name}を{feedAmount}個あげる
                      </button>
                    </div>
                  </>
                )}
                  </>
                )}
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
