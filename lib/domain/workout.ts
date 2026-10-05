import { z } from "zod";

import { isDateKey } from "@/lib/domain/date";

export const BODY_PARTS = [
  "chest",
  "back",
  "legs",
  "shoulders",
  "arms",
  "abs",
  "cardio",
  "other",
] as const;

export const bodyPartSchema = z.enum(BODY_PARTS);
export type BodyPart = z.infer<typeof bodyPartSchema>;

export const BODY_PART_LABELS: Record<BodyPart, string> = {
  chest: "胸",
  back: "背中",
  legs: "脚",
  shoulders: "肩",
  arms: "腕",
  abs: "腹",
  cardio: "有酸素",
  other: "その他",
};

export const weightUnitSchema = z.enum(["kg", "lb"]);
export type WeightUnit = z.infer<typeof weightUnitSchema>;

export const exerciseSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(60),
    bodyPart: bodyPartSchema,
    isDefault: z.boolean(),
  })
  .strict();

export type Exercise = z.infer<typeof exerciseSchema>;

// 入力時の現実的な上限。DB/既存データの許容範囲(2000kg/1000回/100set)より厳しい。
export const MAX_WEIGHT_KG = 500;
export const MAX_REPS = 200;
export const MAX_SETS = 30;

export const workoutDraftSchema = z
  .object({
    workoutDate: z.string().refine(isDateKey, "日付を確認してください"),
    exerciseId: z.string().min(1, "種目を選んでください").max(100),
    bodyPart: bodyPartSchema,
    weight: z
      .number({ error: "重量を入力してください" })
      .finite()
      .gt(0, "重量は0より大きい値を入力してください"),
    unit: weightUnitSchema,
    reps: z
      .number()
      .int("回数は整数で入力してください")
      .min(1, "回数は1以上で入力してください")
      .max(MAX_REPS, `回数は${MAX_REPS}回以内で入力してください`),
    sets: z
      .number()
      .int("セット数は整数で入力してください")
      .min(1, "セット数は1以上で入力してください")
      .max(MAX_SETS, `セット数は${MAX_SETS}セット以内で入力してください`),
    memo: z.string().trim().max(500, "メモは500文字以内で入力してください"),
  })
  .strict()
  .superRefine((draft, context) => {
    if (
      Number.isFinite(draft.weight) &&
      toKilograms(draft.weight, draft.unit) > MAX_WEIGHT_KG
    ) {
      context.addIssue({
        code: "custom",
        path: ["weight"],
        message: `重量は${MAX_WEIGHT_KG}kg(${Math.floor(fromKilograms(MAX_WEIGHT_KG, "lb"))}lb)以内で入力してください`,
      });
    }
  });

export type WorkoutDraft = z.infer<typeof workoutDraftSchema>;

export const workoutRecordSchema = z
  .object({
    id: z.string().min(1).max(100),
    clientRequestId: z.string().min(1).max(100),
    workoutDate: z.string().refine(isDateKey),
    exerciseId: z.string().min(1).max(100),
    exerciseName: z.string().min(1).max(60),
    bodyPart: bodyPartSchema,
    weightKg: z.number().finite().min(0).max(2000),
    reps: z.number().int().min(1).max(1000),
    sets: z.number().int().min(1).max(100),
    volumeKg: z.number().finite().min(0).max(200_000_000),
    memo: z.string().max(500),
    createdAt: z.string().datetime(),
  })
  .strict();

export type WorkoutRecord = z.infer<typeof workoutRecordSchema>;

export const userSettingsSchema = z
  .object({
    defaultSets: z.number().int().min(1).max(20),
    weightUnit: weightUnitSchema,
  })
  .strict();

export type UserSettings = z.infer<typeof userSettingsSchema>;

export const LB_TO_KG = 0.45359237;

export function roundTo(value: number, digits = 3): number {
  const multiplier = 10 ** digits;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

export function toKilograms(weight: number, unit: WeightUnit): number {
  return roundTo(unit === "kg" ? weight : weight * LB_TO_KG, 3);
}

export function fromKilograms(weightKg: number, unit: WeightUnit): number {
  return roundTo(unit === "kg" ? weightKg : weightKg / LB_TO_KG, 1);
}

export function calculateVolumeKg(
  weight: number,
  unit: WeightUnit,
  reps: number,
  sets: number,
): number {
  if (
    !Number.isFinite(weight) ||
    !Number.isFinite(reps) ||
    !Number.isFinite(sets) ||
    weight < 0 ||
    reps < 1 ||
    sets < 1
  ) {
    return 0;
  }

  return roundTo(toKilograms(weight, unit) * Math.floor(reps) * Math.floor(sets), 3);
}

export function formatWeight(weightKg: number, unit: WeightUnit): string {
  const value = fromKilograms(weightKg, unit);
  return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

export function formatVolume(volumeKg: number): string {
  return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(volumeKg)} kg`;
}
