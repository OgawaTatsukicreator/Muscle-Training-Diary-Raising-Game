"use client";

import {
  ArrowLeft,
  Check,
  ChevronRight,
  Dumbbell,
  Layers3,
  Plus,
  Repeat2,
  Scale,
  StickyNote,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";
import type { ZodError } from "zod";

import { StorageNotice } from "@/components/common/storage-notice";
import { useAppData } from "@/components/providers/app-data-provider";
import { latestBodyWeightKg } from "@/lib/domain/body-weight";
import {
  dateKeyInTimeZone,
  isDateKey,
} from "@/lib/domain/date";
import {
  CALCULATION_PATTERN_LABELS,
  customExerciseQuestion,
  ISOMETRIC_SECONDS_PER_REP,
  MAX_ISOMETRIC_SECONDS,
  patternUsesBodyWeight,
} from "@/lib/domain/load";
import {
  BODY_PART_LABELS,
  BODY_PARTS,
  formatVolume,
  formatWeight,
  fromKilograms,
  MAX_REPS,
  MAX_SETS,
  MAX_WEIGHT_KG,
  toKilograms,
  type BodyPart,
  type Exercise,
  type WeightUnit,
  type WorkoutDraft,
  type WorkoutRecord,
  workoutDraftSchema,
} from "@/lib/domain/workout";
import { evaluateWorkoutDraft } from "@/lib/domain/workout-load";

type FieldErrors = Partial<
  Record<
    | "workoutDate"
    | "exerciseId"
    | "weight"
    | "reps"
    | "sets"
    | "assist"
    | "bodyWeightKg"
    | "volume"
    | "memo",
    string
  >
>;

const PATTERN_EXPLANATIONS = {
  A: "重量 × 回数 × セット数で計算します",
  B: "(体重 × 係数 + 追加重量) × 回数 × セット数で計算します",
  C: "(体重 × 係数 + 追加重量) × 回数 × セット数で計算します",
  D: "(体重 × 係数 + 追加重量 − アシスト) × 回数 × セット数で計算します",
} as const;

/**
 * 記録の入力フォーム。editing を渡すと、保存済みの記録を編集するモードになる。
 * 編集では種目は変えられない(種目を変えるなら削除して記録し直す)。
 */
export function WorkoutEntryForm({
  initialDate,
  editing,
}: {
  initialDate: string;
  editing?: WorkoutRecord;
}) {
  const router = useRouter();
  const {
    exercises,
    bodyWeights,
    settings,
    addExercise,
    addWorkout,
    updateWorkout,
    saveBodyWeight,
    isReady,
  } = useAppData();
  const formRef = useRef<HTMLFormElement>(null);
  const bodyWeightInputRef = useRef<HTMLInputElement>(null);
  const exerciseStepHeadingRef = useRef<HTMLHeadingElement>(null);
  const addingExerciseRef = useRef(false);
  const submittingRef = useRef(false);
  const pendingWorkoutRef = useRef<{
    payload: string;
    requestId: string;
  } | null>(null);
  // 編集のときの初期値は、設定の単位(kg/lb)に直して入力欄へ入れる
  const [step, setStep] = useState<"exercise" | "details">(editing ? "details" : "exercise");
  const [workoutDate, setWorkoutDate] = useState(initialDate);
  const [bodyPart, setBodyPart] = useState<BodyPart>(editing?.bodyPart ?? "chest");
  const [exerciseId, setExerciseId] = useState(editing?.exerciseId ?? "");
  const [weight, setWeight] = useState(
    editing ? String(fromKilograms(editing.weightKg, settings.weightUnit)) : "50",
  );
  const [unitOverride, setUnitOverride] = useState<WeightUnit | null>(null);
  const [reps, setReps] = useState(editing ? String(editing.reps) : "10");
  const [setsOverride, setSetsOverride] = useState<string | null>(
    editing ? String(editing.sets) : null,
  );
  const [assist, setAssist] = useState(
    editing ? String(fromKilograms(editing.assistKg, settings.weightUnit)) : "0",
  );
  const [bodyWeightInput, setBodyWeightInput] = useState<string | null>(
    editing && editing.bodyWeightKg !== null
      ? String(fromKilograms(editing.bodyWeightKg, settings.weightUnit))
      : null,
  );
  const [isSavingBodyWeight, setIsSavingBodyWeight] = useState(false);
  const [bodyWeightNotice, setBodyWeightNotice] = useState<string | null>(null);
  const [memo, setMemo] = useState(editing?.memo ?? "");
  const [newExerciseName, setNewExerciseName] = useState("");
  const [newExerciseUsesBodyweight, setNewExerciseUsesBodyweight] = useState(false);
  const [newExerciseIsometric, setNewExerciseIsometric] = useState(false);
  const [newExerciseError, setNewExerciseError] = useState<string | null>(null);
  const [isAddingExercise, setIsAddingExercise] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const filteredExercises = useMemo(
    () => exercises.filter((exercise) => exercise.bodyPart === bodyPart),
    [bodyPart, exercises],
  );
  const selectedExercise = exercises.find((exercise) => exercise.id === exerciseId);
  const unit = unitOverride ?? settings.weightUnit;
  const sets = setsOverride ?? String(settings.defaultSets);
  const maxWeight = unit === "kg" ? MAX_WEIGHT_KG : Math.floor(fromKilograms(MAX_WEIGHT_KG, "lb"));
  const pattern = selectedExercise?.calculationPattern ?? "A";
  const usesBodyWeight = patternUsesBodyWeight(pattern);
  const isometric = selectedExercise?.isIsometric ?? false;
  const bodyUnit = settings.weightUnit;
  const recordedBodyWeight = bodyWeights.find((entry) => entry.date === workoutDate);
  const lastBodyWeightKg = latestBodyWeightKg(bodyWeights, workoutDate);
  const bodyWeightText =
    bodyWeightInput ??
    (recordedBodyWeight ? String(fromKilograms(recordedBodyWeight.weightKg, bodyUnit)) : "");
  const typedBodyWeightKg =
    bodyWeightText.trim() === ""
      ? null
      : toKilograms(Number(bodyWeightText), bodyUnit);
  const categoryQuestion = customExerciseQuestion(bodyPart);
  const draftInput = {
    workoutDate,
    exerciseId,
    bodyPart,
    weight: weight.trim() === "" ? Number.NaN : Number(weight),
    unit,
    reps: Number(reps),
    sets: Number(sets),
    assist: assist.trim() === "" ? 0 : Number(assist),
    bodyWeightKg: typedBodyWeightKg,
    memo,
  };
  const previewDraft = workoutDraftSchema.safeParse(draftInput);
  const evaluation =
    previewDraft.success && selectedExercise
      ? evaluateWorkoutDraft(previewDraft.data, selectedExercise, lastBodyWeightKg)
      : null;
  const volume = evaluation?.ok ? evaluation.value.volumeKg : 0;
  const loadPerRepKg = evaluation?.ok
    ? evaluation.value.loadPerUnitKg * (isometric ? ISOMETRIC_SECONDS_PER_REP : 1)
    : null;
  const today = dateKeyInTimeZone();

  function selectBodyPart(nextBodyPart: BodyPart) {
    setBodyPart(nextBodyPart);
    setExerciseId("");
    setMessage(null);
  }

  function changeWorkoutDate(nextDate: string) {
    setWorkoutDate(nextDate);
    setBodyWeightInput(null);
    setBodyWeightNotice(null);
    setFieldErrors((current) => ({ ...current, bodyWeightKg: undefined }));
  }

  async function handleSaveBodyWeight() {
    if (isSavingBodyWeight) {
      return;
    }

    const value = Number(bodyWeightText);
    if (bodyWeightText.trim() === "" || !Number.isFinite(value)) {
      setFieldErrors((current) => ({
        ...current,
        bodyWeightKg: "体重を数字で入力してください",
      }));
      return;
    }

    setIsSavingBodyWeight(true);
    const result = await saveBodyWeight(workoutDate, toKilograms(value, bodyUnit));
    setIsSavingBodyWeight(false);

    if (!result.ok) {
      setFieldErrors((current) => ({ ...current, bodyWeightKg: result.message }));
      setBodyWeightNotice(null);
      return;
    }

    setFieldErrors((current) => ({ ...current, bodyWeightKg: undefined }));
    setBodyWeightInput(null);
    setBodyWeightNotice("体重を記録しました");
  }

  function selectExercise(nextExercise: Exercise) {
    // 種目の種類が変わるときだけ、重量・回数の既定値を切り替える
    if (patternUsesBodyWeight(nextExercise.calculationPattern) !== usesBodyWeight) {
      setWeight(usesBodyWeight ? "50" : "0");
    }
    if (nextExercise.isIsometric !== isometric) {
      setReps(nextExercise.isIsometric ? "60" : "10");
    }

    setExerciseId(nextExercise.id);
    setFieldErrors((current) => ({ ...current, exerciseId: undefined }));
    setMessage(null);
    setStep("details");
  }

  async function handleAddExercise() {
    if (addingExerciseRef.current) {
      return;
    }

    addingExerciseRef.current = true;
    setIsAddingExercise(true);
    const result = await addExercise(newExerciseName, bodyPart, {
      usesBodyweight: categoryQuestion === "usesBodyweight" && newExerciseUsesBodyweight,
      isIsometric: categoryQuestion === "isIsometric" && newExerciseIsometric,
    });
    addingExerciseRef.current = false;
    setIsAddingExercise(false);

    if (!result.ok) {
      setNewExerciseError(result.message);
      return;
    }

    setNewExerciseError(null);
    setNewExerciseName("");
    setNewExerciseUsesBodyweight(false);
    setNewExerciseIsometric(false);
    selectExercise(result.data);
    setMessage(`${result.data.name}を種目に追加しました。`);
  }

  function collectErrors(error: ZodError<WorkoutDraft>): FieldErrors {
    const nextErrors: FieldErrors = {};
    for (const issue of error.issues) {
      const field = issue.path[0] as keyof FieldErrors;
      nextErrors[field] ??= issue.message;
    }
    return nextErrors;
  }

  function focusFirstInvalidField(nextErrors: FieldErrors) {
    // 体重の入力欄は種目選択の画面にあるため、そちらへ戻して案内する(編集は詳細画面にある)
    const bodyWeightOnly = Boolean(nextErrors.bodyWeightKg);
    if (!editing && (nextErrors.exerciseId || bodyWeightOnly)) {
      setStep("exercise");
    }

    window.requestAnimationFrame(() => {
      if (nextErrors.exerciseId) {
        exerciseStepHeadingRef.current?.focus();
        return;
      }

      if (bodyWeightOnly) {
        bodyWeightInputRef.current?.focus();
        return;
      }

      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submittingRef.current) {
      return;
    }

    const parsed = workoutDraftSchema.safeParse(draftInput);

    if (!parsed.success) {
      const nextErrors = collectErrors(parsed.error);
      setFieldErrors(nextErrors);
      setMessage("赤字の項目を確認してください。");
      focusFirstInvalidField(nextErrors);
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setFieldErrors({});
    setMessage(null);

    const payload = JSON.stringify(parsed.data);
    if (pendingWorkoutRef.current?.payload !== payload) {
      pendingWorkoutRef.current = {
        payload,
        requestId: crypto.randomUUID(),
      };
    }

    const result = editing
      ? await updateWorkout(editing.id, parsed.data, pendingWorkoutRef.current.requestId)
      : await addWorkout(parsed.data, pendingWorkoutRef.current.requestId);

    if (!result.ok) {
      submittingRef.current = false;
      setIsSubmitting(false);
      const nextErrors = (result.fieldErrors ?? {}) as FieldErrors;
      setFieldErrors(nextErrors);
      setMessage(result.message);
      focusFirstInvalidField(nextErrors);
      return;
    }

    pendingWorkoutRef.current = null;
    router.push(
      `/records?date=${encodeURIComponent(workoutDate)}&${editing ? "updated" : "saved"}=1`,
    );
  }

  return (
    <main className="app-page--focused">
      <div className="mx-auto w-full">
        <p className="mb-4 text-sm font-semibold text-muted">
          {editing ? "内容を直して保存してください" : "タップしてトレーニングを記録しよう"}
        </p>

        <header className="grid grid-cols-[44px_1fr_44px] items-center gap-3 border-y border-line py-3">
          {editing || step === "exercise" ? (
            <Link
              href={`/records?date=${encodeURIComponent(editing?.workoutDate ?? workoutDate)}`}
              aria-label="選択日の記録へ戻る"
              className="grid size-11 place-items-center rounded-full hover:bg-canvas"
            >
              <ArrowLeft aria-hidden="true" size={20} />
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => {
                setStep("exercise");
                setMessage(null);
              }}
              aria-label="種目選択へ戻る"
              className="grid size-11 place-items-center rounded-full hover:bg-canvas"
            >
              <ArrowLeft aria-hidden="true" size={20} />
            </button>
          )}
          <div className="min-w-0 text-center">
            <p className="data-number truncate text-xs text-muted">
              {isDateKey(workoutDate) ? workoutDate.replaceAll("-", "/") : "日付を選択"}
            </p>
            <h1 className="mt-0.5 truncate text-base font-semibold">
              {editing
                ? "記録を編集"
                : step === "exercise"
                  ? "種目を選択"
                  : selectedExercise?.name ?? "数値を入力"}
            </h1>
          </div>
          <span aria-hidden="true" />
        </header>

        <StorageNotice />

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          onKeyDown={(event) => {
            // Enterでの意図しない保存を防ぐ。保存は「この記録を保存」ボタンのみ。
            if (
              event.key === "Enter" &&
              event.target instanceof HTMLInputElement &&
              event.target.type !== "submit"
            ) {
              event.preventDefault();
            }
          }}
          noValidate
        >
          {step === "exercise" ? (
            <section className="mt-5" aria-labelledby="exercise-step-title">
              <div className="flex flex-col items-stretch gap-3 min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                <div>
                  <p className="text-[10px] font-bold tracking-[0.12em] text-muted uppercase">
                    Step 1
                  </p>
                  <h2
                    ref={exerciseStepHeadingRef}
                    id="exercise-step-title"
                    tabIndex={-1}
                    className="mt-1 text-lg font-semibold"
                  >
                    鍛えた部位と種目
                  </h2>
                </div>
                <label className="text-left text-[10px] font-bold text-muted min-[360px]:text-right">
                  トレーニング日
                  <input
                    type="date"
                    value={workoutDate}
                    max={today}
                    onChange={(event) => changeWorkoutDate(event.target.value)}
                    className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-white px-2 text-xs font-bold text-ink min-[360px]:w-auto"
                    aria-invalid={Boolean(fieldErrors.workoutDate)}
                    aria-describedby={fieldErrors.workoutDate ? "workout-date-error" : undefined}
                  />
                </label>
              </div>
              {fieldErrors.workoutDate ? (
                <p id="workout-date-error" className="mt-2 text-sm font-bold text-accent-strong">
                  {fieldErrors.workoutDate}
                </p>
              ) : null}

              <section
                aria-labelledby="body-weight-label"
                className="mt-5 rounded-xl border border-line bg-canvas/35 p-4"
              >
                <label
                  id="body-weight-label"
                  htmlFor="body-weight"
                  className="flex items-center gap-2 text-xs font-bold text-muted"
                >
                  <Scale aria-hidden="true" size={15} />
                  今日の体重（任意）
                </label>
                <div className="mt-2 flex gap-2">
                  <div className="flex min-h-12 min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-white focus-within:border-ink">
                    <input
                      id="body-weight"
                      ref={bodyWeightInputRef}
                      type="number"
                      inputMode="decimal"
                      min="1"
                      step="0.1"
                      value={bodyWeightText}
                      placeholder={
                        lastBodyWeightKg !== null
                          ? `前回 ${fromKilograms(lastBodyWeightKg, bodyUnit)}`
                          : "例 65.0"
                      }
                      onChange={(event) => {
                        setBodyWeightInput(event.target.value);
                        setBodyWeightNotice(null);
                        setFieldErrors((current) => ({ ...current, bodyWeightKg: undefined }));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void handleSaveBodyWeight();
                        }
                      }}
                      className="data-number min-w-0 flex-1 bg-transparent px-3 text-lg font-bold outline-none"
                      aria-invalid={Boolean(fieldErrors.bodyWeightKg)}
                      aria-describedby="body-weight-hint"
                    />
                    <span className="grid place-items-center border-l border-line bg-canvas/60 px-3 text-xs font-bold text-muted">
                      {bodyUnit}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSaveBodyWeight()}
                    disabled={!isReady || isSavingBodyWeight}
                    className="min-h-12 shrink-0 rounded-xl border border-ink bg-white px-4 text-xs font-bold hover:bg-canvas disabled:cursor-wait disabled:opacity-55"
                  >
                    {isSavingBodyWeight ? "記録中" : "記録"}
                  </button>
                </div>
                <p id="body-weight-hint" className="mt-2 text-xs leading-5 text-muted">
                  {bodyWeightNotice ??
                    (recordedBodyWeight && bodyWeightInput === null
                      ? "この日の体重は記録済みです。"
                      : "自重を使う種目の計算に使います。未入力なら直近の体重を使います。")}
                </p>
                {fieldErrors.bodyWeightKg ? (
                  <p role="alert" className="mt-2 text-xs font-bold text-accent-strong">
                    {fieldErrors.bodyWeightKg}
                  </p>
                ) : null}
              </section>

              <fieldset className="mt-5">
                <legend className="sr-only">鍛えた部位</legend>
                <div className="grid grid-cols-4 gap-2">
                  {BODY_PARTS.map((part) => {
                    const selected = part === bodyPart;
                    return (
                      <label
                        key={part}
                        className={`choice-control grid min-h-12 cursor-pointer place-items-center rounded-lg border px-1 text-xs font-bold transition-colors ${
                          selected
                            ? "border-accent bg-accent text-white"
                            : "border-line bg-white text-muted hover:border-ink hover:text-ink"
                        }`}
                      >
                        <input
                          type="radio"
                          name="body-part"
                          value={part}
                          checked={selected}
                          disabled={isAddingExercise}
                          onChange={() => selectBodyPart(part)}
                          className="sr-only"
                        />
                        {BODY_PART_LABELS[part]}
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="mt-5 flex items-center justify-between gap-3">
                <p className="text-xs font-bold text-muted">
                  {BODY_PART_LABELS[bodyPart]}の種目
                </p>
                <details className="relative">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full border border-line px-3 text-xs font-bold hover:bg-canvas [&::-webkit-details-marker]:hidden">
                    <Plus aria-hidden="true" size={15} />
                    部位・種目を追加
                  </summary>
                  <div className="absolute top-13 right-0 z-10 w-[min(82vw,330px)] rounded-xl border border-line bg-white p-4 shadow-xl">
                    <label htmlFor="new-exercise-name" className="text-xs font-bold">
                      {BODY_PART_LABELS[bodyPart]}に種目を追加
                    </label>
                    <div className="mt-2 flex gap-2">
                      <input
                        id="new-exercise-name"
                        type="text"
                        value={newExerciseName}
                        disabled={isAddingExercise}
                        onChange={(event) => {
                          setNewExerciseName(event.target.value);
                          setNewExerciseError(null);
                        }}
                        placeholder="種目名"
                        maxLength={60}
                        className="min-h-11 min-w-0 flex-1 rounded-lg border border-line px-3 text-sm"
                        aria-invalid={Boolean(newExerciseError)}
                        aria-describedby={newExerciseError ? "new-exercise-error" : undefined}
                      />
                      <button
                        type="button"
                        onClick={handleAddExercise}
                        disabled={!isReady || isAddingExercise}
                        className="min-h-11 shrink-0 rounded-lg bg-accent px-4 text-xs font-bold text-white disabled:cursor-wait disabled:bg-line disabled:text-muted"
                      >
                        {isAddingExercise ? "追加中" : "追加"}
                      </button>
                    </div>
                    {categoryQuestion === "usesBodyweight" ? (
                      <label className="mt-3 flex items-start gap-2 text-xs leading-5">
                        <input
                          type="checkbox"
                          checked={newExerciseUsesBodyweight}
                          disabled={isAddingExercise}
                          onChange={(event) => setNewExerciseUsesBodyweight(event.target.checked)}
                          className="mt-0.5 size-4 shrink-0"
                        />
                        自重も使う種目（スクワット・ランジなど）
                      </label>
                    ) : null}
                    {categoryQuestion === "isIsometric" ? (
                      <label className="mt-3 flex items-start gap-2 text-xs leading-5">
                        <input
                          type="checkbox"
                          checked={newExerciseIsometric}
                          disabled={isAddingExercise}
                          onChange={(event) => setNewExerciseIsometric(event.target.checked)}
                          className="mt-0.5 size-4 shrink-0"
                        />
                        秒数で行う種目（プランクなど）
                      </label>
                    ) : null}
                    <p className="mt-3 text-[11px] leading-5 text-muted">
                      {bodyPart === "abs"
                        ? "腹の種目は自重で計算します。"
                        : bodyPart === "legs"
                          ? "脚の種目は、自重を使うか選べます。"
                          : "ウエイトの重量で計算します。"}
                    </p>
                    {newExerciseError ? (
                      <p
                        id="new-exercise-error"
                        role="alert"
                        className="mt-2 text-xs font-bold text-accent-strong"
                      >
                        {newExerciseError}
                      </p>
                    ) : null}
                  </div>
                </details>
              </div>

              {fieldErrors.exerciseId ? (
                <p id="exercise-error" className="mt-3 text-sm font-bold text-accent-strong">
                  {fieldErrors.exerciseId}
                </p>
              ) : null}

              {!isReady ? (
                <div
                  aria-live="polite"
                  className="mt-3 rounded-xl border border-line bg-canvas p-8 text-center text-sm text-muted"
                >
                  種目を読み込んでいます。
                </div>
              ) : filteredExercises.length > 0 ? (
                <ul className="mt-3 space-y-3">
                  {filteredExercises.map((exercise) => (
                    <li key={exercise.id}>
                      <button
                        type="button"
                        onClick={() => selectExercise(exercise)}
                        disabled={isAddingExercise}
                        className="flex min-h-24 w-full items-center justify-between gap-4 rounded-xl border border-line bg-white px-5 py-4 text-left transition-colors hover:border-ink hover:bg-canvas disabled:cursor-wait disabled:opacity-55"
                      >
                        <span>
                          <span className="block text-[10px] font-bold text-muted">
                            {BODY_PART_LABELS[exercise.bodyPart]} · {CALCULATION_PATTERN_LABELS[exercise.calculationPattern]}
                          </span>
                          <span className="mt-1 block font-semibold">{exercise.name}</span>
                        </span>
                        <ChevronRight aria-hidden="true" className="shrink-0 text-muted" size={20} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
                  この部位の種目はまだありません。上のボタンから追加できます。
                </div>
              )}

              {message ? (
                <p role="status" aria-live="polite" className="mt-4 text-sm font-bold">
                  {message}
                </p>
              ) : null}
            </section>
          ) : (
            <div className="mt-5 space-y-5">
              <section className="rounded-xl border border-line bg-canvas/35 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-accent-strong">
                      {BODY_PART_LABELS[bodyPart]}
                    </p>
                    <h2 className="mt-1 truncate text-lg font-semibold">
                      {selectedExercise?.name}
                    </h2>
                  </div>
                  {editing ? null : (
                    <button
                      type="button"
                      onClick={() => setStep("exercise")}
                      className="min-h-11 shrink-0 rounded-lg border border-line bg-white px-3 text-xs font-bold"
                    >
                      選び直す
                    </button>
                  )}
                </div>
                <label htmlFor="workout-date" className="mt-4 block border-t border-line pt-3 text-xs font-bold text-muted">
                  トレーニング日
                  <input
                    id="workout-date"
                    type="date"
                    value={workoutDate}
                    max={today}
                    onChange={(event) => changeWorkoutDate(event.target.value)}
                    className="mt-2 min-h-12 w-full rounded-lg border border-line bg-white px-3 text-sm font-bold text-ink"
                    aria-invalid={Boolean(fieldErrors.workoutDate)}
                    aria-describedby={fieldErrors.workoutDate ? "workout-date-error-details" : undefined}
                  />
                </label>
                {fieldErrors.workoutDate ? (
                  <p id="workout-date-error-details" className="mt-2 text-sm font-bold text-accent-strong">
                    {fieldErrors.workoutDate}
                  </p>
                ) : null}
              </section>

              <section aria-labelledby="details-step-title">
                <div>
                  <p className="text-[10px] font-bold tracking-[0.12em] text-muted uppercase">
                    Step 2
                  </p>
                  <h2 id="details-step-title" className="mt-1 text-lg font-semibold">
                    {isometric ? "重量・秒数・セット数" : "重量・回数・セット数"}
                  </h2>
                </div>

                {usesBodyWeight && editing ? (
                  <div className="mt-4">
                    <label htmlFor="body-weight" className="mb-2 flex items-center gap-2 text-xs font-bold text-muted">
                      <Scale aria-hidden="true" size={15} />
                      この日の体重
                    </label>
                    <div className="flex min-h-14 overflow-hidden rounded-xl border border-line bg-white focus-within:border-ink">
                      <input
                        id="body-weight"
                        ref={bodyWeightInputRef}
                        type="number"
                        inputMode="decimal"
                        min="1"
                        step="0.1"
                        value={bodyWeightText}
                        placeholder={
                          lastBodyWeightKg !== null
                            ? `直近 ${fromKilograms(lastBodyWeightKg, bodyUnit)}`
                            : "例 65.0"
                        }
                        onChange={(event) => {
                          setBodyWeightInput(event.target.value);
                          setFieldErrors((current) => ({ ...current, bodyWeightKg: undefined }));
                        }}
                        className="data-number min-w-0 flex-1 bg-transparent px-3 text-xl font-bold outline-none"
                        aria-invalid={Boolean(fieldErrors.bodyWeightKg)}
                        aria-describedby={fieldErrors.bodyWeightKg ? "body-weight-edit-error" : undefined}
                      />
                      <span className="grid place-items-center border-l border-line bg-canvas/60 px-4 text-xs font-bold text-muted">
                        {bodyUnit}
                      </span>
                    </div>
                    {fieldErrors.bodyWeightKg ? (
                      <p id="body-weight-edit-error" role="alert" className="mt-2 text-xs font-bold text-accent-strong">
                        {fieldErrors.bodyWeightKg}
                      </p>
                    ) : null}
                  </div>
                ) : usesBodyWeight ? (
                  <div className="mt-4 rounded-xl border border-line bg-white px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="flex min-w-0 items-center gap-2 text-sm font-bold">
                        <Scale aria-hidden="true" className="shrink-0 text-muted" size={16} />
                        <span className="truncate">
                          体重{" "}
                          {typedBodyWeightKg !== null
                            ? formatWeight(typedBodyWeightKg, bodyUnit)
                            : lastBodyWeightKg !== null
                              ? `${formatWeight(lastBodyWeightKg, bodyUnit)}（直近の記録）`
                              : "未入力"}
                        </span>
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setStep("exercise");
                          window.requestAnimationFrame(() => bodyWeightInputRef.current?.focus());
                        }}
                        className="min-h-11 shrink-0 rounded-lg border border-line px-3 text-xs font-bold hover:bg-canvas"
                      >
                        変更
                      </button>
                    </div>
                    {fieldErrors.bodyWeightKg ? (
                      <p role="alert" className="mt-2 text-xs font-bold text-accent-strong">
                        {fieldErrors.bodyWeightKg}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div>
                    <label htmlFor="workout-weight" className="mb-2 flex items-center gap-2 text-xs font-bold text-muted">
                      <Scale aria-hidden="true" size={15} />
                      {usesBodyWeight ? "追加重量（なしなら0）" : "重量"}
                    </label>
                    <div className="flex min-h-14 overflow-hidden rounded-xl border border-line bg-white focus-within:border-ink">
                      <input
                        id="workout-weight"
                        type="number"
                        inputMode="decimal"
                        min={usesBodyWeight ? "0" : "0.1"}
                        max={maxWeight}
                        step="0.1"
                        value={weight}
                        onChange={(event) => setWeight(event.target.value)}
                        className="data-number min-w-0 flex-1 bg-transparent px-3 text-xl font-bold outline-none"
                        aria-invalid={Boolean(fieldErrors.weight)}
                        aria-describedby={fieldErrors.weight ? "weight-error" : undefined}
                      />
                      <div className="flex border-l border-line bg-canvas/60 p-1" role="group" aria-label="重量単位">
                        {(["kg", "lb"] as const).map((item) => (
                          <button
                            key={item}
                            type="button"
                            aria-pressed={unit === item}
                            onClick={() => setUnitOverride(item)}
                            className={`min-w-10 rounded-lg px-2 text-xs font-bold ${
                              unit === item ? "bg-accent text-white" : "text-muted"
                            }`}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                    {fieldErrors.weight ? (
                      <p id="weight-error" className="mt-2 text-xs font-bold text-accent-strong">
                        {fieldErrors.weight}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <label htmlFor="workout-reps" className="mb-2 flex items-center gap-2 text-xs font-bold text-muted">
                      <Repeat2 aria-hidden="true" size={15} />
                      {isometric ? "秒数" : "回数"}
                    </label>
                    <div className="flex min-h-14 items-center rounded-xl border border-line bg-white">
                      <input
                        id="workout-reps"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max={isometric ? MAX_ISOMETRIC_SECONDS : MAX_REPS}
                        step="1"
                        value={reps}
                        onChange={(event) => setReps(event.target.value)}
                        className="data-number min-w-0 flex-1 bg-transparent px-4 text-xl font-bold outline-none"
                        aria-invalid={Boolean(fieldErrors.reps)}
                        aria-describedby={fieldErrors.reps ? "reps-error" : undefined}
                      />
                      <span className="pr-4 text-xs font-bold text-muted">{isometric ? "秒" : "回"}</span>
                    </div>
                    {fieldErrors.reps ? (
                      <p id="reps-error" className="mt-2 text-xs font-bold text-accent-strong">
                        {fieldErrors.reps}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <label htmlFor="workout-sets" className="mb-2 flex items-center gap-2 text-xs font-bold text-muted">
                      <Layers3 aria-hidden="true" size={15} />
                      セット数
                    </label>
                    <div className="flex min-h-14 items-center rounded-xl border border-line bg-white">
                      <input
                        id="workout-sets"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max={MAX_SETS}
                        step="1"
                        value={sets}
                        onChange={(event) => setSetsOverride(event.target.value)}
                        className="data-number min-w-0 flex-1 bg-transparent px-4 text-xl font-bold outline-none"
                        aria-invalid={Boolean(fieldErrors.sets)}
                        aria-describedby={fieldErrors.sets ? "sets-error" : undefined}
                      />
                      <span className="pr-4 text-xs font-bold text-muted">set</span>
                    </div>
                    {fieldErrors.sets ? (
                      <p id="sets-error" className="mt-2 text-xs font-bold text-accent-strong">
                        {fieldErrors.sets}
                      </p>
                    ) : null}
                  </div>
                </div>

                {pattern === "D" ? (
                  <div className="mt-4">
                    <label htmlFor="workout-assist" className="mb-2 flex items-center gap-2 text-xs font-bold text-muted">
                      <Scale aria-hidden="true" size={15} />
                      アシスト重量（マシンの補助・なしなら0）
                    </label>
                    <div className="flex min-h-14 overflow-hidden rounded-xl border border-line bg-white focus-within:border-ink">
                      <input
                        id="workout-assist"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max={maxWeight}
                        step="0.1"
                        value={assist}
                        onChange={(event) => setAssist(event.target.value)}
                        className="data-number min-w-0 flex-1 bg-transparent px-3 text-xl font-bold outline-none"
                        aria-invalid={Boolean(fieldErrors.assist)}
                        aria-describedby={fieldErrors.assist ? "assist-error" : undefined}
                      />
                      <span className="grid place-items-center border-l border-line bg-canvas/60 px-4 text-xs font-bold text-muted">
                        {unit}
                      </span>
                    </div>
                    {fieldErrors.assist ? (
                      <p id="assist-error" className="mt-2 text-xs font-bold text-accent-strong">
                        {fieldErrors.assist}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <label htmlFor="workout-memo" className="mt-5 block">
                  <span className="mb-2 flex items-center gap-2 text-xs font-bold text-muted">
                    <StickyNote aria-hidden="true" size={15} />
                    メモ（任意）
                  </span>
                  <textarea
                    id="workout-memo"
                    value={memo}
                    onChange={(event) => setMemo(event.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="フォームや体調など"
                    className="w-full resize-y rounded-xl border border-line bg-white px-4 py-3 text-sm leading-6"
                    aria-invalid={Boolean(fieldErrors.memo)}
                    aria-describedby={fieldErrors.memo ? "memo-error" : undefined}
                  />
                  {fieldErrors.memo ? (
                    <span id="memo-error" className="mt-2 block text-xs font-bold text-accent-strong">
                      {fieldErrors.memo}
                    </span>
                  ) : null}
                </label>
              </section>

              <section className="overflow-hidden rounded-xl border border-accent/30 bg-accent-soft">
                <div className="flex items-center justify-between gap-4 px-5 py-5">
                  <div>
                    <p className="text-xs font-bold text-muted">トータルボリューム</p>
                    <p className="data-number mt-1 text-[clamp(2rem,10vw,3rem)] leading-none font-bold">
                      {formatVolume(volume)}
                    </p>
                  </div>
                  <Dumbbell aria-hidden="true" className="shrink-0 text-muted" size={32} />
                </div>
                <p className="border-t border-ink/15 px-5 py-3 text-xs font-bold text-muted">
                  {PATTERN_EXPLANATIONS[pattern]}
                  {loadPerRepKg !== null && usesBodyWeight
                    ? `（${isometric ? "10秒" : "1回"}あたり ${formatVolume(loadPerRepKg)}）`
                    : ""}
                </p>
              </section>
              {fieldErrors.volume ? (
                <p role="alert" className="text-sm font-bold text-accent-strong">
                  {fieldErrors.volume}
                </p>
              ) : null}

              {message ? (
                <p role="status" aria-live="polite" className="rounded-xl border border-line bg-white px-4 py-3 text-sm font-bold">
                  {message}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={!isReady || isSubmitting}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 py-4 text-base font-bold text-white shadow-[0_6px_0_var(--accent-shadow)] active:translate-y-1 active:shadow-none disabled:cursor-wait disabled:bg-line disabled:text-muted disabled:shadow-none"
              >
                <Check aria-hidden="true" size={20} strokeWidth={3} />
                {isSubmitting ? "保存しています" : editing ? "変更を保存" : "この記録を保存"}
              </button>
            </div>
          )}
        </form>
      </div>
    </main>
  );
}
