import { z } from "zod";

import { DEFAULT_EXERCISES } from "@/lib/data/default-exercises";
import { bodyWeightEntrySchema } from "@/lib/domain/body-weight";
import { DEFAULT_MASO_NAME, storedNameSchema } from "@/lib/domain/display-name";
import { EMPTY_FOOD_ITEMS } from "@/lib/domain/growth";
import { exerciseSchema, userSettingsSchema, workoutRecordSchema } from "@/lib/domain/workout";

// Keep the existing key and format so previously saved preview data remains readable.
export const GUEST_STORAGE_KEY = "maso-diary:local-preview:v1";
export const MAX_LOCAL_RECORDS = 5_000;
export const MAX_LOCAL_EXERCISES = 1_000;
export const MAX_LOCAL_BODY_WEIGHTS = 3_700;

const masoStatusSchema = z.object({
  name: storedNameSchema(DEFAULT_MASO_NAME),
  level: z.number().int().min(1).max(999),
  experience: z.number().int().min(0).max(99_900),
  growthPoints: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  food: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  protein: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  items: z.object({
    banana: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    chicken: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    steak: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  }).strict().default({ ...EMPTY_FOOD_ITEMS }),
}).strict();

export type MasoStatus = z.infer<typeof masoStatusSchema>;

const persistedStateSchema = z.object({
  version: z.literal(1),
  records: z.array(workoutRecordSchema).max(MAX_LOCAL_RECORDS),
  exercises: z.array(exerciseSchema).max(MAX_LOCAL_EXERCISES),
  bodyWeights: z.array(bodyWeightEntrySchema).max(MAX_LOCAL_BODY_WEIGHTS).default([]),
  settings: userSettingsSchema,
  maso: masoStatusSchema,
}).strict();

export type DemoDataState = z.infer<typeof persistedStateSchema>;
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

export type GuestMutation<T> = { state: DemoDataState; result: ActionResult<T> };

export function initialGuestState(): DemoDataState {
  return {
    version: 1,
    records: [],
    exercises: [...DEFAULT_EXERCISES],
    bodyWeights: [],
    settings: { defaultSets: 3, weightUnit: "kg" },
    maso: {
      name: DEFAULT_MASO_NAME,
      level: 1,
      experience: 0,
      growthPoints: 0,
      food: 0,
      protein: 0,
      items: { ...EMPTY_FOOD_ITEMS },
    },
  };
}

export function parseGuestState(raw: string): DemoDataState {
  const parsed = persistedStateSchema.parse(JSON.parse(raw));
  return {
    ...parsed,
    exercises: [...DEFAULT_EXERCISES, ...parsed.exercises.filter((exercise) => !exercise.isDefault)],
  };
}
