import {
  calculateLoadPerUnitKg,
  calculateVolumeFromLoad,
  ISOMETRIC_SECONDS_PER_REP,
  MAX_VOLUME_KG,
  patternUsesBodyWeight,
} from "@/lib/domain/load";
import {
  formatWeight,
  MAX_REPS,
  toKilograms,
  type Exercise,
  type WeightUnit,
  type WorkoutDraft,
  type WorkoutRecord,
} from "@/lib/domain/workout";

export type DraftFieldKey =
  | "weight"
  | "reps"
  | "assist"
  | "bodyWeightKg"
  | "volume";

export type DraftFieldErrors = Partial<Record<DraftFieldKey, string>>;

export type WorkoutCalculation = {
  weightKg: number;
  assistKg: number;
  /** 記録に残す体重。外部ウエイトのみの種目で体重が無い場合は null */
  bodyWeightKg: number | null;
  loadPerUnitKg: number;
  volumeKg: number;
};

export type WorkoutEvaluation =
  | { ok: true; value: WorkoutCalculation }
  | { ok: false; fieldErrors: DraftFieldErrors };

type ExerciseLoadSpec = Pick<
  Exercise,
  "calculationPattern" | "bwRatio" | "isIsometric"
>;

/**
 * 入力済みの下書きを種目の換算パターンで評価する。DBの save_workout と
 * 同じ規則(supabase/migrations/0003_load_calculation.sql)で、サーバー側でも再検証される。
 *
 * @param fallbackBodyWeightKg 下書きに体重が無いとき使う、当日以前の直近の体重
 */
export function evaluateWorkoutDraft(
  draft: WorkoutDraft,
  exercise: ExerciseLoadSpec,
  fallbackBodyWeightKg: number | null,
): WorkoutEvaluation {
  const fieldErrors: DraftFieldErrors = {};
  const pattern = exercise.calculationPattern;
  const weightKg = toKilograms(draft.weight, draft.unit);
  const assistKg = pattern === "D" ? toKilograms(draft.assist, draft.unit) : 0;
  const explicitBodyWeightKg = draft.bodyWeightKg;
  const needsBodyWeight = patternUsesBodyWeight(pattern);
  const bodyWeightKg =
    explicitBodyWeightKg ?? (needsBodyWeight ? fallbackBodyWeightKg : null);

  if (!exercise.isIsometric && draft.reps > MAX_REPS) {
    fieldErrors.reps = `回数は${MAX_REPS}回以内で入力してください`;
  }

  if (pattern === "A" && weightKg <= 0) {
    fieldErrors.weight = "重量は0より大きい値を入力してください";
  }

  if (needsBodyWeight && bodyWeightKg === null) {
    fieldErrors.bodyWeightKg = "体重を入力してください";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  const loadPerUnitKg = calculateLoadPerUnitKg({
    pattern,
    bwRatio: exercise.bwRatio,
    isIsometric: exercise.isIsometric,
    bodyWeightKg,
    weightKg,
    assistKg,
  });

  if (loadPerUnitKg === null) {
    return {
      ok: false,
      fieldErrors:
        pattern === "D" && assistKg > 0
          ? {
              assist:
                "アシストが大きすぎます。自重を支える負荷が残る値にしてください",
            }
          : { weight: "重量を確認してください" },
    };
  }

  const volumeKg = calculateVolumeFromLoad(
    loadPerUnitKg,
    draft.reps,
    draft.sets,
  );

  if (volumeKg > MAX_VOLUME_KG) {
    return {
      ok: false,
      fieldErrors: {
        volume:
          "1回の記録のボリュームが大きすぎます。重量・回数・セット数を確認してください",
      },
    };
  }

  return {
    ok: true,
    value: { weightKg, assistKg, bodyWeightKg, loadPerUnitKg, volumeKg },
  };
}

/**
 * 記録一覧用の説明。ウエイトのみの種目と旧記録は「重量 × 回数 × セット」、
 * 自重を使う種目は1回あたりの総負荷も添える。
 */
export function describeRecordLoad(
  record: Pick<
    WorkoutRecord,
    "weightKg" | "reps" | "sets" | "loadPerUnitKg" | "assistKg"
  >,
  exercise: Pick<Exercise, "calculationPattern" | "isIsometric"> | undefined,
  unit: WeightUnit,
): string {
  const repsText = `${record.reps}${exercise?.isIsometric ? "秒" : "回"}`;
  const volumeText = `${repsText} × ${record.sets}セット`;

  if (
    !exercise ||
    exercise.calculationPattern === "A" ||
    record.loadPerUnitKg === null
  ) {
    return `${formatWeight(record.weightKg, unit)} × ${volumeText}`;
  }

  const unitLoadKg = exercise.isIsometric
    ? record.loadPerUnitKg * ISOMETRIC_SECONDS_PER_REP
    : record.loadPerUnitKg;
  const extras = [
    record.weightKg > 0 ? `+${formatWeight(record.weightKg, unit)}` : null,
    record.assistKg > 0 ? `アシスト-${formatWeight(record.assistKg, unit)}` : null,
  ].filter(Boolean);
  const perText = exercise.isIsometric ? "10秒" : "1回";

  return `${volumeText}${extras.length > 0 ? `(${extras.join(" ")})` : ""} · ${perText}あたり${formatWeight(unitLoadKg, unit)}`;
}
