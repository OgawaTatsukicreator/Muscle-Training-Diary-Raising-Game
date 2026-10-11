import { z } from "zod";

import { bodyWeightEntrySchema, latestBodyWeightKg, upsertBodyWeight, type BodyWeightEntry } from "@/lib/domain/body-weight";
import { dateKeyInTimeZone } from "@/lib/domain/date";
import { displayNameFieldSchema } from "@/lib/domain/display-name";
import { applyExperience, FOOD_ITEMS, foodBalance, isValidItemActionAmount, rewardsFromVolume, workoutRewardAdjustment, withFoodBalance, type FoodKind } from "@/lib/domain/growth";
import { defaultsForCustomExercise, type CustomExerciseOptions } from "@/lib/domain/load";
import { bodyPartSchema, userSettingsSchema, workoutDraftSchema, type BodyPart, type Exercise, type UserSettings, type WorkoutDraft, type WorkoutRecord } from "@/lib/domain/workout";
import { evaluateWorkoutDraft } from "@/lib/domain/workout-load";
import { MAX_LOCAL_BODY_WEIGHTS, MAX_LOCAL_EXERCISES, MAX_LOCAL_RECORDS, type ActionResult, type DemoDataState, type GuestMutation, type MasoStatus } from "@/lib/storage/guest-state";

function failure<T>(state: DemoDataState, message: string, fieldErrors?: Record<string, string>): GuestMutation<T> {
  return { state, result: { ok: false, message, ...(fieldErrors ? { fieldErrors } : {}) } };
}

function success<T>(state: DemoDataState, data: T): GuestMutation<T> {
  return { state, result: { ok: true, data } };
}

function issueMap(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[String(issue.path[0] ?? "form")] ??= issue.message;
  return fields;
}

function bodyWeightsWithEntry(state: DemoDataState, date: string, weightKg: number | null): ActionResult<BodyWeightEntry[]> {
  if (weightKg === null) return { ok: true, data: state.bodyWeights };
  if (state.bodyWeights.length >= MAX_LOCAL_BODY_WEIGHTS && !state.bodyWeights.some((entry) => entry.date === date)) {
    return { ok: false, message: "この端末に保存できる体重記録の上限に達しました。" };
  }
  return { ok: true, data: upsertBodyWeight(state.bodyWeights, { date, weightKg }) };
}

export function addGuestWorkout(state: DemoDataState, draft: WorkoutDraft, clientRequestId: string): GuestMutation<WorkoutRecord> {
  const parsed = workoutDraftSchema.safeParse(draft);
  if (!parsed.success) return failure(state, "入力内容を確認してください。", issueMap(parsed.error));
  if (parsed.data.workoutDate > dateKeyInTimeZone()) return failure(state, "未来日の記録はまだ保存できません。");
  if (!clientRequestId || clientRequestId.length > 100) return failure(state, "保存操作を確認できません。画面を開き直してください。");

  const duplicate = state.records.find((record) => record.clientRequestId === clientRequestId);
  if (duplicate) return success(state, duplicate);
  if (state.records.length >= MAX_LOCAL_RECORDS) {
    return failure(state, "この端末に保存できる記録件数の上限に達しました。アカウントのクラウド保存をご利用ください。");
  }
  const exercise = state.exercises.find((item) => item.id === parsed.data.exerciseId && item.bodyPart === parsed.data.bodyPart);
  if (!exercise) return failure(state, "選択した種目を確認できませんでした。部位から選び直してください。");
  const evaluation = evaluateWorkoutDraft(parsed.data, exercise, latestBodyWeightKg(state.bodyWeights, parsed.data.workoutDate));
  if (!evaluation.ok) return failure(state, "入力内容を確認してください。", evaluation.fieldErrors);
  const bodyWeights = bodyWeightsWithEntry(state, parsed.data.workoutDate, parsed.data.bodyWeightKg);
  if (!bodyWeights.ok) return failure(state, bodyWeights.message);

  const { weightKg, assistKg, bodyWeightKg, loadPerUnitKg, volumeKg, reps, sets } = evaluation.value;
  const rewards = rewardsFromVolume(volumeKg);
  const nextGrowthPoints = state.maso.growthPoints + rewards.growthPoints;
  if (!Number.isSafeInteger(nextGrowthPoints)) return failure(state, "育成値が保存可能な上限を超えるため、この記録は保存できません。");
  const record: WorkoutRecord = {
    id: crypto.randomUUID(), clientRequestId, workoutDate: parsed.data.workoutDate,
    exerciseId: exercise.id, exerciseName: exercise.name, bodyPart: exercise.bodyPart,
    weightKg, reps, sets, volumeKg, bodyWeightKg, assistKg, loadPerUnitKg,
    rewardPoints: rewards.growthPoints, memo: parsed.data.memo, createdAt: new Date().toISOString(),
  };
  return success({
    ...state, records: [...state.records, record], bodyWeights: bodyWeights.data,
    maso: { ...state.maso, growthPoints: nextGrowthPoints },
  }, record);
}

export function updateGuestWorkout(state: DemoDataState, workoutId: string, draft: WorkoutDraft): GuestMutation<WorkoutRecord> {
  const parsed = workoutDraftSchema.safeParse(draft);
  if (!parsed.success) return failure(state, "入力内容を確認してください。", issueMap(parsed.error));
  if (parsed.data.workoutDate > dateKeyInTimeZone()) return failure(state, "未来日の記録はまだ保存できません。");
  const current = state.records.find((record) => record.id === workoutId);
  if (!current) return failure(state, "記録が見つかりませんでした。すでに削除された可能性があります。");
  const exercise = state.exercises.find((item) => item.id === current.exerciseId);
  if (!exercise) return failure(state, "この記録の種目を確認できませんでした。");
  const evaluation = evaluateWorkoutDraft(parsed.data, exercise, latestBodyWeightKg(state.bodyWeights, parsed.data.workoutDate));
  if (!evaluation.ok) return failure(state, "入力内容を確認してください。", evaluation.fieldErrors);
  const bodyWeights = bodyWeightsWithEntry(state, parsed.data.workoutDate, parsed.data.bodyWeightKg);
  if (!bodyWeights.ok) return failure(state, bodyWeights.message);
  const { weightKg, assistKg, bodyWeightKg, loadPerUnitKg, volumeKg, reps, sets } = evaluation.value;
  const adjustment = workoutRewardAdjustment({
    granted: current.rewardPoints ?? rewardsFromVolume(current.volumeKg).growthPoints,
    volumeKg, balance: state.maso.growthPoints,
  });
  const nextGrowthPoints = state.maso.growthPoints + adjustment.applied;
  if (!Number.isSafeInteger(nextGrowthPoints)) return failure(state, "育成値が保存可能な上限を超えるため、この記録は保存できません。");
  const updated: WorkoutRecord = {
    ...current, workoutDate: parsed.data.workoutDate, weightKg, reps, sets, volumeKg,
    bodyWeightKg, assistKg, loadPerUnitKg, rewardPoints: adjustment.granted, memo: parsed.data.memo,
  };
  return success({
    ...state, records: state.records.map((record) => record.id === workoutId ? updated : record),
    bodyWeights: bodyWeights.data, maso: { ...state.maso, growthPoints: nextGrowthPoints },
  }, updated);
}

export function deleteGuestWorkout(state: DemoDataState, workoutId: string): GuestMutation<{ growthPointsDelta: number }> {
  const current = state.records.find((record) => record.id === workoutId);
  if (!current) return success(state, { growthPointsDelta: 0 });
  const adjustment = workoutRewardAdjustment({
    granted: current.rewardPoints ?? rewardsFromVolume(current.volumeKg).growthPoints,
    volumeKg: 0, balance: state.maso.growthPoints,
  });
  return success({
    ...state, records: state.records.filter((record) => record.id !== workoutId),
    maso: { ...state.maso, growthPoints: Math.max(0, state.maso.growthPoints + adjustment.applied) },
  }, { growthPointsDelta: adjustment.applied });
}

export function addGuestExercise(state: DemoDataState, name: string, bodyPart: BodyPart, options?: CustomExerciseOptions): GuestMutation<Exercise> {
  const normalizedName = name.trim().replace(/\s+/g, " ");
  if (!normalizedName || normalizedName.length > 60 || !bodyPartSchema.safeParse(bodyPart).success) {
    return failure(state, "種目名は1〜60文字で入力し、部位を選んでください。");
  }
  const existing = state.exercises.find((exercise) => exercise.bodyPart === bodyPart && exercise.name.toLocaleLowerCase("ja-JP") === normalizedName.toLocaleLowerCase("ja-JP"));
  if (existing) return success(state, existing);
  if (state.exercises.length >= MAX_LOCAL_EXERCISES) return failure(state, "この端末に保存できる種目数の上限に達しました。");
  const exercise: Exercise = {
    id: `local-${crypto.randomUUID()}`, name: normalizedName, bodyPart, isDefault: false,
    ...defaultsForCustomExercise(bodyPart, options),
  };
  return success({ ...state, exercises: [...state.exercises, exercise] }, exercise);
}

export function saveGuestBodyWeight(state: DemoDataState, date: string, weightKg: number): GuestMutation<BodyWeightEntry> {
  const parsed = bodyWeightEntrySchema.safeParse({ date, weightKg });
  if (!parsed.success) return failure(state, "体重は20〜300kgで入力してください。");
  if (parsed.data.date > dateKeyInTimeZone()) return failure(state, "未来日の体重は記録できません。");
  const bodyWeights = bodyWeightsWithEntry(state, parsed.data.date, parsed.data.weightKg);
  if (!bodyWeights.ok) return failure(state, bodyWeights.message);
  return success({ ...state, bodyWeights: bodyWeights.data }, parsed.data);
}

export function updateGuestSettings(state: DemoDataState, settings: UserSettings): GuestMutation<UserSettings> {
  const parsed = userSettingsSchema.safeParse(settings);
  if (!parsed.success) return failure(state, "設定値を確認してください。");
  if (state.settings.defaultSets === parsed.data.defaultSets && state.settings.weightUnit === parsed.data.weightUnit) return success(state, parsed.data);
  return success({ ...state, settings: parsed.data }, parsed.data);
}

export function exchangeGuestGrowthPoints(state: DemoDataState, kind: FoodKind, amount = 1): GuestMutation<MasoStatus> {
  if (!isValidItemActionAmount(amount) || !Object.hasOwn(FOOD_ITEMS, kind)) return failure(state, "交換する種類と個数を確認してください。");
  const totalCost = amount * FOOD_ITEMS[kind].growthPointCost;
  if (!Number.isSafeInteger(totalCost) || state.maso.growthPoints < totalCost) return failure(state, "育成ポイントが足りません。");
  const nextInventory = foodBalance(state.maso, kind) + amount;
  if (!Number.isSafeInteger(nextInventory)) return failure(state, "これ以上アイテムを所持できません。");
  const nextMaso = withFoodBalance({ ...state.maso, growthPoints: state.maso.growthPoints - totalCost }, kind, nextInventory);
  return success({ ...state, maso: nextMaso }, nextMaso);
}

export function feedGuestMaso(state: DemoDataState, kind: FoodKind, amount = 1): GuestMutation<MasoStatus> {
  if (!isValidItemActionAmount(amount) || !Object.hasOwn(FOOD_ITEMS, kind)) return failure(state, "あげる種類と個数を確認してください。");
  const item = FOOD_ITEMS[kind];
  if (foodBalance(state.maso, kind) < amount) return failure(state, `${item.name}が足りません。育成ポイントと交換できます。`);
  const nextExperience = applyExperience(state.maso.level, state.maso.experience, amount * item.experience);
  const nextMaso = withFoodBalance({ ...state.maso, level: nextExperience.level, experience: nextExperience.experience }, kind, foodBalance(state.maso, kind) - amount);
  return success({ ...state, maso: nextMaso }, nextMaso);
}

export function renameGuestMaso(state: DemoDataState, name: string): GuestMutation<MasoStatus> {
  const parsed = displayNameFieldSchema("名前").safeParse(name);
  if (!parsed.success) return failure(state, parsed.error.issues[0]?.message ?? "名前を確認してください。");
  if (state.maso.name === parsed.data) return success(state, state.maso);
  const nextMaso = { ...state.maso, name: parsed.data };
  return success({ ...state, maso: nextMaso }, nextMaso);
}
