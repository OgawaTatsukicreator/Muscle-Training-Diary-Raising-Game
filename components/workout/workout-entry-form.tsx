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
import {
  dateKeyInTimeZone,
  isDateKey,
} from "@/lib/domain/date";
import {
  BODY_PART_LABELS,
  BODY_PARTS,
  calculateVolumeKg,
  formatVolume,
  fromKilograms,
  MAX_REPS,
  MAX_SETS,
  MAX_WEIGHT_KG,
  type BodyPart,
  type WeightUnit,
  type WorkoutDraft,
  workoutDraftSchema,
} from "@/lib/domain/workout";

type FieldErrors = Partial<
  Record<"workoutDate" | "exerciseId" | "weight" | "reps" | "sets" | "memo", string>
>;

export function WorkoutEntryForm({ initialDate }: { initialDate: string }) {
  const router = useRouter();
  const { exercises, settings, addExercise, addWorkout, isReady } = useAppData();
  const formRef = useRef<HTMLFormElement>(null);
  const exerciseStepHeadingRef = useRef<HTMLHeadingElement>(null);
  const addingExerciseRef = useRef(false);
  const submittingRef = useRef(false);
  const pendingWorkoutRef = useRef<{
    payload: string;
    requestId: string;
  } | null>(null);
  const [step, setStep] = useState<"exercise" | "details">("exercise");
  const [workoutDate, setWorkoutDate] = useState(initialDate);
  const [bodyPart, setBodyPart] = useState<BodyPart>("chest");
  const [exerciseId, setExerciseId] = useState("");
  const [weight, setWeight] = useState("50");
  const [unitOverride, setUnitOverride] = useState<WeightUnit | null>(null);
  const [reps, setReps] = useState("10");
  const [setsOverride, setSetsOverride] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [newExerciseName, setNewExerciseName] = useState("");
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
  const volume = calculateVolumeKg(
    Number(weight),
    unit,
    Number(reps),
    Number(sets),
  );
  const today = dateKeyInTimeZone();

  function selectBodyPart(nextBodyPart: BodyPart) {
    setBodyPart(nextBodyPart);
    setExerciseId("");
    setMessage(null);
  }

  function selectExercise(nextExerciseId: string) {
    setExerciseId(nextExerciseId);
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
    const result = await addExercise(newExerciseName, bodyPart);
    addingExerciseRef.current = false;
    setIsAddingExercise(false);

    if (!result.ok) {
      setNewExerciseError(result.message);
      return;
    }

    setNewExerciseError(null);
    setNewExerciseName("");
    selectExercise(result.data.id);
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
    if (nextErrors.exerciseId) {
      setStep("exercise");
    }

    window.requestAnimationFrame(() => {
      if (nextErrors.exerciseId) {
        exerciseStepHeadingRef.current?.focus();
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

    const draft = {
      workoutDate,
      exerciseId,
      bodyPart,
      weight: weight.trim() === "" ? Number.NaN : Number(weight),
      unit,
      reps: Number(reps),
      sets: Number(sets),
      memo,
    };
    const parsed = workoutDraftSchema.safeParse(draft);

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

    const result = await addWorkout(
      parsed.data,
      pendingWorkoutRef.current.requestId,
    );

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
    router.push(`/records?date=${encodeURIComponent(workoutDate)}&saved=1`);
  }

  return (
    <main className="app-page--focused">
      <div className="mx-auto w-full">
        <p className="mb-4 text-sm font-semibold text-muted">
          タップしてトレーニングを記録しよう
        </p>

        <header className="grid grid-cols-[44px_1fr_44px] items-center gap-3 border-y border-line py-3">
          {step === "exercise" ? (
            <Link
              href={`/records?date=${encodeURIComponent(workoutDate)}`}
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
              {step === "exercise" ? "種目を選択" : selectedExercise?.name ?? "数値を入力"}
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
                    onChange={(event) => setWorkoutDate(event.target.value)}
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
                        onClick={() => selectExercise(exercise.id)}
                        disabled={isAddingExercise}
                        className="flex min-h-24 w-full items-center justify-between gap-4 rounded-xl border border-line bg-white px-5 py-4 text-left transition-colors hover:border-ink hover:bg-canvas disabled:cursor-wait disabled:opacity-55"
                      >
                        <span>
                          <span className="block text-[10px] font-bold text-muted">
                            {BODY_PART_LABELS[exercise.bodyPart]}
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
                  <button
                    type="button"
                    onClick={() => setStep("exercise")}
                    className="min-h-11 shrink-0 rounded-lg border border-line bg-white px-3 text-xs font-bold"
                  >
                    選び直す
                  </button>
                </div>
                <label htmlFor="workout-date" className="mt-4 block border-t border-line pt-3 text-xs font-bold text-muted">
                  トレーニング日
                  <input
                    id="workout-date"
                    type="date"
                    value={workoutDate}
                    max={today}
                    onChange={(event) => setWorkoutDate(event.target.value)}
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
                    重量・回数・セット数
                  </h2>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div>
                    <label htmlFor="workout-weight" className="mb-2 flex items-center gap-2 text-xs font-bold text-muted">
                      <Scale aria-hidden="true" size={15} />
                      重量
                    </label>
                    <div className="flex min-h-14 overflow-hidden rounded-xl border border-line bg-white focus-within:border-ink">
                      <input
                        id="workout-weight"
                        type="number"
                        inputMode="decimal"
                        min="0.1"
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
                      回数
                    </label>
                    <div className="flex min-h-14 items-center rounded-xl border border-line bg-white">
                      <input
                        id="workout-reps"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max={MAX_REPS}
                        step="1"
                        value={reps}
                        onChange={(event) => setReps(event.target.value)}
                        className="data-number min-w-0 flex-1 bg-transparent px-4 text-xl font-bold outline-none"
                        aria-invalid={Boolean(fieldErrors.reps)}
                        aria-describedby={fieldErrors.reps ? "reps-error" : undefined}
                      />
                      <span className="pr-4 text-xs font-bold text-muted">回</span>
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
                  重量 × 回数 × セット数をkgへ換算して自動計算
                </p>
              </section>

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
                {isSubmitting ? "保存しています" : "この記録を保存"}
              </button>
            </div>
          )}
        </form>
      </div>
    </main>
  );
}
