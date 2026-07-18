"use client";

import {
  ArrowLeft,
  Check,
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
import { useDemoData } from "@/components/providers/demo-data-provider";
import {
  dateKeyInTimeZone,
  formatJapaneseDate,
  isDateKey,
} from "@/lib/domain/date";
import {
  BODY_PART_LABELS,
  BODY_PARTS,
  calculateVolumeKg,
  formatVolume,
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
  const { exercises, settings, addExercise, addWorkout, isReady } = useDemoData();
  const submittingRef = useRef(false);
  const [workoutDate, setWorkoutDate] = useState(initialDate);
  const [bodyPart, setBodyPart] = useState<BodyPart>("chest");
  const firstExercise = exercises.find((exercise) => exercise.bodyPart === "chest");
  const [exerciseId, setExerciseId] = useState(firstExercise?.id ?? "");
  const [weight, setWeight] = useState("50");
  const [unitOverride, setUnitOverride] = useState<WeightUnit | null>(null);
  const [reps, setReps] = useState("10");
  const [setsOverride, setSetsOverride] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [newExerciseName, setNewExerciseName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const filteredExercises = useMemo(
    () => exercises.filter((exercise) => exercise.bodyPart === bodyPart),
    [bodyPart, exercises],
  );
  const unit = unitOverride ?? settings.weightUnit;
  const sets = setsOverride ?? String(settings.defaultSets);
  const volume = calculateVolumeKg(
    Number(weight),
    unit,
    Number(reps),
    Number(sets),
  );
  const today = dateKeyInTimeZone();

  function selectBodyPart(nextBodyPart: BodyPart) {
    setBodyPart(nextBodyPart);
    const nextExercise = exercises.find(
      (exercise) => exercise.bodyPart === nextBodyPart,
    );
    setExerciseId(nextExercise?.id ?? "");
    setMessage(null);
  }

  function handleAddExercise() {
    const result = addExercise(newExerciseName, bodyPart);

    if (!result.ok) {
      setMessage(result.message);
      return;
    }

    setExerciseId(result.data.id);
    setNewExerciseName("");
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      setFieldErrors(collectErrors(parsed.error));
      setMessage("赤字の項目を確認してください。");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setFieldErrors({});
    setMessage(null);

    const result = addWorkout(parsed.data, crypto.randomUUID());

    if (!result.ok) {
      submittingRef.current = false;
      setIsSubmitting(false);
      setFieldErrors((result.fieldErrors ?? {}) as FieldErrors);
      setMessage(result.message);
      return;
    }

    router.push(`/records?date=${encodeURIComponent(workoutDate)}&saved=1`);
  }

  return (
    <main className="app-page--focused">
      <div className="mx-auto w-full max-w-[760px]">
        <header className="mb-6 flex items-center gap-4">
          <Link
            href={`/records?date=${encodeURIComponent(workoutDate)}`}
            aria-label="記録画面へ戻る"
            className="grid size-12 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink"
          >
            <ArrowLeft aria-hidden="true" size={20} />
          </Link>
          <div>
            <p className="text-[11px] font-black tracking-[0.16em] text-accent-strong uppercase">
              Workout entry
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-[-0.04em]">
              トレーニング記録
            </h1>
          </div>
        </header>

        <StorageNotice />

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <section className="surface-panel rounded-[30px] p-5 sm:p-7">
            <div className="mb-6 flex items-center justify-between gap-4 border-b border-line pb-5">
              <div>
                <label htmlFor="workout-date" className="text-xs font-bold text-muted">
                  トレーニング日
                </label>
                <p className="mt-1 text-lg font-black">
                  {isDateKey(workoutDate)
                    ? formatJapaneseDate(workoutDate)
                    : "日付を選択"}
                </p>
              </div>
              <input
                id="workout-date"
                type="date"
                value={workoutDate}
                max={today}
                onChange={(event) => setWorkoutDate(event.target.value)}
                className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm font-bold"
                aria-invalid={Boolean(fieldErrors.workoutDate)}
                aria-describedby={fieldErrors.workoutDate ? "workout-date-error" : undefined}
              />
            </div>
            {fieldErrors.workoutDate ? (
              <p id="workout-date-error" className="-mt-3 mb-4 text-sm font-bold text-accent-strong">
                {fieldErrors.workoutDate}
              </p>
            ) : null}

            <fieldset>
              <legend className="mb-3 text-sm font-black">1. 鍛えた部位</legend>
              <div className="grid grid-cols-4 gap-2">
                {BODY_PARTS.map((part) => {
                  const selected = part === bodyPart;
                  return (
                    <label
                      key={part}
                      className={`choice-control grid min-h-12 cursor-pointer place-items-center rounded-xl border px-2 py-2 text-sm font-bold transition-colors ${
                        selected
                          ? "border-ink bg-ink text-white"
                          : "border-line bg-white text-muted hover:text-ink"
                      }`}
                    >
                      <input
                        type="radio"
                        name="body-part"
                        value={part}
                        checked={selected}
                        onChange={() => selectBodyPart(part)}
                        className="sr-only"
                      />
                      {BODY_PART_LABELS[part]}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-6">
              <label htmlFor="exercise" className="mb-2 block text-sm font-black">
                2. 種目
              </label>
              <select
                id="exercise"
                value={exerciseId}
                onChange={(event) => setExerciseId(event.target.value)}
                className="min-h-13 w-full rounded-2xl border border-line bg-white px-4 font-bold"
                required
                aria-invalid={Boolean(fieldErrors.exerciseId)}
                aria-describedby={fieldErrors.exerciseId ? "exercise-error" : undefined}
              >
                <option value="">種目を選択</option>
                {filteredExercises.map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {exercise.name}
                  </option>
                ))}
              </select>
              {fieldErrors.exerciseId ? (
                <p id="exercise-error" className="mt-2 text-sm font-bold text-accent-strong">
                  {fieldErrors.exerciseId}
                </p>
              ) : null}

              <details className="mt-3 rounded-2xl border border-dashed border-line bg-canvas/50 px-4 py-3">
                <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-sm font-bold [&::-webkit-details-marker]:hidden">
                  <Plus aria-hidden="true" size={17} />
                  未登録の種目を追加
                </summary>
                <div className="mt-3 flex gap-2 border-t border-line pt-3">
                  <input
                    type="text"
                    aria-label="追加する種目名"
                    value={newExerciseName}
                    onChange={(event) => setNewExerciseName(event.target.value)}
                    placeholder={`${BODY_PART_LABELS[bodyPart]}の種目名`}
                    maxLength={60}
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleAddExercise}
                    className="min-h-11 shrink-0 rounded-xl bg-ink px-4 text-sm font-black text-white"
                  >
                    追加
                  </button>
                </div>
              </details>
            </div>
          </section>

          <section className="surface-panel rounded-[30px] p-5 sm:p-7">
            <h2 className="mb-5 text-sm font-black">3. 数値を入力</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="block">
                <label htmlFor="workout-weight" className="mb-2 flex items-center gap-2 text-xs font-bold text-muted">
                  <Scale aria-hidden="true" size={15} />
                  重量
                </label>
                <div className="flex overflow-hidden rounded-2xl border border-line bg-white focus-within:border-ink">
                  <input
                    id="workout-weight"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="2000"
                    step="0.1"
                    value={weight}
                    onChange={(event) => setWeight(event.target.value)}
                    className="data-number min-h-14 min-w-0 flex-1 bg-transparent px-4 text-xl font-black outline-none"
                    aria-invalid={Boolean(fieldErrors.weight)}
                    aria-describedby={fieldErrors.weight ? "weight-error" : undefined}
                  />
                  <div
                    className="flex border-l border-line bg-canvas/60 p-1"
                    role="group"
                    aria-label="重量単位"
                  >
                    {(["kg", "lb"] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        aria-pressed={unit === item}
                        onClick={() => setUnitOverride(item)}
                        className={`min-w-10 rounded-lg px-2 text-xs font-black ${
                          unit === item ? "bg-ink text-white" : "text-muted"
                        }`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
                {fieldErrors.weight ? (
                  <span id="weight-error" className="mt-2 block text-xs font-bold text-accent-strong">
                    {fieldErrors.weight}
                  </span>
                ) : null}
              </div>

              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-xs font-bold text-muted">
                  <Repeat2 aria-hidden="true" size={15} />
                  回数
                </span>
                <div className="flex min-h-14 items-center rounded-2xl border border-line bg-white">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="1000"
                    step="1"
                    value={reps}
                    onChange={(event) => setReps(event.target.value)}
                    className="data-number min-w-0 flex-1 bg-transparent px-4 text-xl font-black outline-none"
                    aria-invalid={Boolean(fieldErrors.reps)}
                    aria-describedby={fieldErrors.reps ? "reps-error" : undefined}
                  />
                  <span className="pr-4 text-xs font-bold text-muted">回</span>
                </div>
                {fieldErrors.reps ? (
                  <span id="reps-error" className="mt-2 block text-xs font-bold text-accent-strong">
                    {fieldErrors.reps}
                  </span>
                ) : null}
              </label>

              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-xs font-bold text-muted">
                  <Layers3 aria-hidden="true" size={15} />
                  セット数
                </span>
                <div className="flex min-h-14 items-center rounded-2xl border border-line bg-white">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="100"
                    step="1"
                    value={sets}
                    onChange={(event) => setSetsOverride(event.target.value)}
                    className="data-number min-w-0 flex-1 bg-transparent px-4 text-xl font-black outline-none"
                    aria-invalid={Boolean(fieldErrors.sets)}
                    aria-describedby={fieldErrors.sets ? "sets-error" : undefined}
                  />
                  <span className="pr-4 text-xs font-bold text-muted">set</span>
                </div>
                {fieldErrors.sets ? (
                  <span id="sets-error" className="mt-2 block text-xs font-bold text-accent-strong">
                    {fieldErrors.sets}
                  </span>
                ) : null}
              </label>
            </div>

            <label className="mt-5 block">
              <span className="mb-2 flex items-center gap-2 text-xs font-bold text-muted">
                <StickyNote aria-hidden="true" size={15} />
                メモ（任意）
              </span>
              <textarea
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="フォームや体調など"
                className="w-full resize-y rounded-2xl border border-line bg-white px-4 py-3 text-sm leading-6"
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

          <section className="overflow-hidden rounded-[30px] border-2 border-ink bg-lime">
            <div className="flex items-center justify-between gap-4 px-5 py-5 sm:px-7">
              <div>
                <p className="text-xs font-black text-ink/65">トータルボリューム</p>
                <p className="data-number mt-1 text-[clamp(2rem,10vw,3.5rem)] leading-none font-black">
                  {formatVolume(volume)}
                </p>
              </div>
              <Dumbbell aria-hidden="true" className="shrink-0 text-ink/70" size={34} />
            </div>
            <p className="border-t border-ink/20 px-5 py-3 text-xs font-bold text-ink/65 sm:px-7">
              重量 × 回数 × セット数をkgへ換算して計算
            </p>
          </section>

          {message ? (
            <p
              role="status"
              aria-live="polite"
              className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-bold"
            >
              {message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={!isReady || isSubmitting}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent-strong px-6 py-4 text-lg font-black text-white shadow-[0_7px_0_var(--accent-shadow)] transition-transform hover:-translate-y-0.5 active:translate-y-1 active:shadow-none disabled:cursor-wait disabled:bg-line disabled:text-muted disabled:shadow-none"
          >
            <Check aria-hidden="true" size={21} strokeWidth={3} />
            {isSubmitting ? "保存しています" : "この記録を保存"}
          </button>
        </form>
      </div>
    </main>
  );
}
