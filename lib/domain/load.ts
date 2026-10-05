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

/** ユーザー追加種目に割り当てる標準の体重係数。 */
export const CUSTOM_BW_RATIO = {
  /** 脚の種目で「自重も使う」と答えた場合(ランジ系の係数に合わせる) */
  legs: 0.74,
  /** 腹の種目(クランチ0.40〜シットアップ0.60の中間) */
  abs: 0.5,
} as const;

export function patternUsesBodyWeight(pattern: CalculationPattern): boolean {
  return pattern !== "A";
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

function roundLoad(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
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

  return roundLoad(isIsometric ? load / ISOMETRIC_SECONDS_PER_REP : load);
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

  return roundLoad(loadPerUnitKg * Math.floor(reps) * Math.floor(sets));
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
