import type { BodyPart } from "@/lib/domain/workout";

/**
 * 種目ごとの「総負荷」換算。
 *
 * A: 純・外部ウエイト      load = weight
 * B: 自体重+ウエイト(脚)   load = weight + BW × ratio
 * C: 自体重のみ            load = BW × ratio + weight(加重時のみ)
 * D: ぶら下がり・支持      load = BW × ratio + weight − assist
 *
 * 総負荷はマソ君の成長ポイントの元になる「目安」であり、厳密な生体力学値ではない。
 * 係数は種目マスター(lib/data/exercise-master.ts)と、下の定数で調整する。
 */
export const CALCULATION_PATTERNS = ["A", "B", "C", "D"] as const;
export type CalculationPattern = (typeof CALCULATION_PATTERNS)[number];

/** 静的種目(プランク等)は秒数で入力し、この秒数を1レップとして換算する。 */
export const ISOMETRIC_SECONDS_PER_REP = 10;

/** 入力の許容範囲。DB(supabase/migrations/0003)の検証と揃えること。 */
export const MIN_BODY_WEIGHT_KG = 20;
export const MAX_BODY_WEIGHT_KG = 300;
/** 静的種目は秒数入力のため、回数の上限が大きい */
export const MAX_ISOMETRIC_SECONDS = 600;
/** 1回の記録で許容するボリュームの上限(明らかな入力ミス・不正値の防止) */
export const MAX_VOLUME_KG = 50_000;

/** ユーザー追加種目に割り当てる標準の体重係数。 */
export const CUSTOM_BW_RATIO = {
  /** 脚の種目で「自重も使う」と答えた場合(ランジ系の係数に合わせる) */
  legs: 0.74,
  /** 腹の種目(クランチ0.40〜シットアップ0.60の中間) */
  abs: 0.5,
} as const;

export const CALCULATION_PATTERN_LABELS: Record<CalculationPattern, string> = {
  A: "ウエイト",
  B: "体重+ウエイト",
  C: "自重",
  D: "自重(ぶら下がり・支持)",
};

export function patternUsesBodyWeight(pattern: CalculationPattern): boolean {
  return pattern !== "A";
}

/**
 * 換算の対象にしない部位。記録(時間)は残すが、ボリュームは0で育成ポイントも付かない。
 * 種目ごとの換算パターンは使わない。DBは exercises.body_part で判定する(0008)。
 */
export const UNCONVERTED_BODY_PARTS: readonly BodyPart[] = ["cardio"];

/** 未換算の種目は「回数」の欄に時間(分)を入れる。上限は10時間。 */
export const MAX_UNCONVERTED_MINUTES = 600;

export function isUnconvertedBodyPart(bodyPart: BodyPart): boolean {
  return UNCONVERTED_BODY_PARTS.includes(bodyPart);
}

/** 種目一覧に添える換算の種類。 */
export function conversionLabel(exercise: {
  bodyPart: BodyPart;
  calculationPattern: CalculationPattern;
}): string {
  return isUnconvertedBodyPart(exercise.bodyPart)
    ? "未換算"
    : CALCULATION_PATTERN_LABELS[exercise.calculationPattern];
}

export interface LoadInput {
  pattern: CalculationPattern;
  bwRatio: number;
  isIsometric: boolean;
  /** その日の体重(kg)。パターンAでは不要 */
  bodyWeightKg: number | null;
  /** 入力した(追加)重量(kg換算済み) */
  weightKg: number;
  /** パターンDのマシンアシスト(kg換算済み)。D以外では無視する */
  assistKg?: number;
}

function roundTo(value: number, digits: number): number {
  const multiplier = 10 ** digits;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

/**
 * 1レップ(静的種目は1秒)あたりの総負荷(kg)。入力が不正、または総負荷が
 * 0以下になる場合は null を返す。呼び出し側でエラーとして扱うこと。
 */
export function calculateLoadPerUnitKg(input: LoadInput): number | null {
  const { pattern, bwRatio, isIsometric, bodyWeightKg, weightKg } = input;
  const assistKg = pattern === "D" ? (input.assistKg ?? 0) : 0;

  if (
    !Number.isFinite(weightKg) ||
    weightKg < 0 ||
    !Number.isFinite(assistKg) ||
    assistKg < 0 ||
    !Number.isFinite(bwRatio) ||
    bwRatio < 0
  ) {
    return null;
  }

  let bodyLoad = 0;
  if (patternUsesBodyWeight(pattern)) {
    if (bodyWeightKg === null || !Number.isFinite(bodyWeightKg) || bodyWeightKg <= 0) {
      return null;
    }
    bodyLoad = bodyWeightKg * bwRatio;
  }

  const load = bodyLoad + weightKg - assistKg;
  if (!(load > 0)) {
    return null;
  }

  // DBの load_per_unit_kg(小数4桁)と同じ丸め
  return roundTo(isIsometric ? load / ISOMETRIC_SECONDS_PER_REP : load, 4);
}

/** 総ボリューム = 1単位あたり負荷 × 回数(静的種目は秒数) × セット数。 */
export function calculateVolumeFromLoad(
  loadPerUnitKg: number | null,
  reps: number,
  sets: number,
): number {
  if (
    loadPerUnitKg === null ||
    !Number.isFinite(loadPerUnitKg) ||
    loadPerUnitKg <= 0 ||
    !Number.isFinite(reps) ||
    !Number.isFinite(sets) ||
    reps < 1 ||
    sets < 1
  ) {
    return 0;
  }

  return roundTo(loadPerUnitKg * Math.floor(reps) * Math.floor(sets), 3);
}

export interface CustomExerciseOptions {
  /** 脚の種目のみ質問する: 自重も使う種目か */
  usesBodyweight?: boolean;
  /** 腹の種目のみ: 秒数で行う種目か */
  isIsometric?: boolean;
}

export interface CustomExerciseDefaults {
  calculationPattern: CalculationPattern;
  bwRatio: number;
  isIsometric: boolean;
}

/** 追加時にユーザーへ尋ねる必要がある項目(部位による)。 */
export function customExerciseQuestion(
  bodyPart: BodyPart,
): "usesBodyweight" | "isIsometric" | null {
  if (bodyPart === "legs") return "usesBodyweight";
  if (bodyPart === "abs") return "isIsometric";
  return null;
}

/**
 * ユーザー追加種目の換算パターンを部位から決める。
 * 脚のみ自重の有無を質問し、腹は自重のみ、その他は外部ウエイトのみとみなす。
 */
export function defaultsForCustomExercise(
  bodyPart: BodyPart,
  options: CustomExerciseOptions = {},
): CustomExerciseDefaults {
  if (bodyPart === "legs" && options.usesBodyweight) {
    return { calculationPattern: "B", bwRatio: CUSTOM_BW_RATIO.legs, isIsometric: false };
  }

  if (bodyPart === "abs") {
    return {
      calculationPattern: "C",
      bwRatio: CUSTOM_BW_RATIO.abs,
      isIsometric: options.isIsometric === true,
    };
  }

  return { calculationPattern: "A", bwRatio: 0, isIsometric: false };
}
