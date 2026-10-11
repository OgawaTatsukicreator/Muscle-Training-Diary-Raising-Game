import { z } from "zod";

import { bodyWeightEntrySchema, upsertBodyWeight } from "@/lib/domain/body-weight";
import { workoutRecordSchema, type Exercise, type WorkoutRecord } from "@/lib/domain/workout";
import type { createClient } from "@/lib/supabase/client";

type Client = NonNullable<ReturnType<typeof createClient>>;

export function createAsyncQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation, operation);
    tail = next.catch(() => undefined);
    return next;
  };
}
const nullableNumeric = z.union([z.number(), z.string()]).nullable()
  .transform((value) => value === null ? null : Number(value))
  .pipe(z.number().finite().nullable());

export const WORKOUT_COLUMNS = "id, client_request_id, workout_date, exercise_id, weight_kg, reps, sets, volume_kg, body_weight_kg, assist_kg, load_per_unit_kg, memo, created_at";
const rowSchema = z.object({
  id: z.string().uuid(), client_request_id: z.string().uuid(),
  workout_date: z.string(), exercise_id: z.string().uuid(),
  weight_kg: z.coerce.number().finite().min(0).max(2000),
  reps: z.number().int().min(1).max(1000), sets: z.number().int().min(1).max(100),
  volume_kg: z.coerce.number().finite().min(0).max(200_000_000),
  body_weight_kg: nullableNumeric, assist_kg: z.coerce.number().finite().min(0),
  load_per_unit_kg: z.coerce.number().finite().min(0), memo: z.string().max(500),
  created_at: z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString()),
});

export function decodeWorkoutRow(value: unknown, exercises: readonly Exercise[]): WorkoutRecord {
  const row = rowSchema.parse(value);
  const exercise = exercises.find((item) => item.id === row.exercise_id);
  if (!exercise) throw new Error("Workout exercise is unavailable");
  return workoutRecordSchema.parse({
    id: row.id, clientRequestId: row.client_request_id, workoutDate: row.workout_date,
    exerciseId: row.exercise_id, exerciseName: exercise.name, bodyPart: exercise.bodyPart,
    weightKg: row.weight_kg, reps: row.reps, sets: row.sets, volumeKg: row.volume_kg,
    bodyWeightKg: row.body_weight_kg, assistKg: row.assist_kg, loadPerUnitKg: row.load_per_unit_kg,
    memo: row.memo, createdAt: row.created_at,
  });
}

const statusSchema = z.object({ growth_points: z.number().int().min(0) });
const weightSchema = z.object({ log_date: z.string(), weight_kg: z.coerce.number().finite() });

// Read the canonical changed row and balance, independent of history size.
// RLS remains enforced; every query also explicitly scopes the current user.
export async function fetchWorkoutChange(
  client: Client, userId: string, workoutId: string,
  exercises: readonly Exercise[], bodyWeightDate?: string,
) {
  const [recordResult, statusResult, weightResult] = await Promise.all([
    client.from("workout_logs").select(WORKOUT_COLUMNS).eq("user_id", userId)
      .eq("id", workoutId).is("deleted_at", null).maybeSingle(),
    client.from("maso_status").select("growth_points").eq("user_id", userId).single(),
    bodyWeightDate
      ? client.from("body_weight_logs").select("log_date, weight_kg").eq("user_id", userId)
        .eq("log_date", bodyWeightDate).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (recordResult.error || statusResult.error || weightResult.error) {
    throw new Error("Could not confirm changed workout");
  }
  const weight = weightResult.data ? weightSchema.parse(weightResult.data) : null;
  return {
    record: recordResult.data ? decodeWorkoutRow(recordResult.data, exercises) : null,
    growthPoints: statusSchema.parse(statusResult.data).growth_points,
    bodyWeight: weight ? bodyWeightEntrySchema.parse({ date: weight.log_date, weightKg: weight.weight_kg }) : null,
  };
}

export function applyWorkoutChange<T extends {
  records: WorkoutRecord[]; bodyWeights: z.infer<typeof bodyWeightEntrySchema>[];
  maso: { growthPoints: number };
}>(current: T, workoutId: string, change: Awaited<ReturnType<typeof fetchWorkoutChange>>): T {
  const found = current.records.some((item) => item.id === workoutId);
  return {
    ...current,
    records: change.record
      ? found ? current.records.map((item) => item.id === workoutId ? change.record! : item)
        : [...current.records, change.record]
      : current.records.filter((item) => item.id !== workoutId),
    maso: { ...current.maso, growthPoints: change.growthPoints },
    bodyWeights: change.bodyWeight ? upsertBodyWeight(current.bodyWeights, change.bodyWeight) : current.bodyWeights,
  };
}
