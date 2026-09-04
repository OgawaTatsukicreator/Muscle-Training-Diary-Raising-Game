"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";

import { DEFAULT_EXERCISES } from "@/lib/data/default-exercises";
import { dateKeyInTimeZone } from "@/lib/domain/date";
import {
  applyExperience,
  FOOD_ITEMS,
  MAX_ITEM_ACTION_AMOUNT,
  rewardsFromVolume,
  type FoodKind,
} from "@/lib/domain/growth";
import {
  calculateVolumeKg,
  exerciseSchema,
  toKilograms,
  type BodyPart,
  type Exercise,
  type UserSettings,
  userSettingsSchema,
  type WorkoutDraft,
  type WorkoutRecord,
  workoutDraftSchema,
  workoutRecordSchema,
} from "@/lib/domain/workout";

const STORAGE_KEY = "maso-diary:local-preview:v1";
const MAX_LOCAL_RECORDS = 5_000;
const MAX_LOCAL_EXERCISES = 1_000;

const masoStatusSchema = z
  .object({
    name: z.string().trim().min(1).max(30),
    level: z.number().int().min(1).max(999),
    experience: z.number().int().min(0).max(99_900),
    growthPoints: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    food: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    protein: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  })
  .strict();

export type MasoStatus = z.infer<typeof masoStatusSchema>;

const persistedStateSchema = z
  .object({
    version: z.literal(1),
    records: z.array(workoutRecordSchema).max(MAX_LOCAL_RECORDS),
    exercises: z.array(exerciseSchema).max(MAX_LOCAL_EXERCISES),
    settings: userSettingsSchema,
    maso: masoStatusSchema,
  })
  .strict();

export type DemoDataState = z.infer<typeof persistedStateSchema>;

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

export type DemoDataContextValue = DemoDataState & {
  isReady: boolean;
  storageIssue: string | null;
  addWorkout: (
    draft: WorkoutDraft,
    clientRequestId: string,
  ) => ActionResult<WorkoutRecord>;
  addExercise: (name: string, bodyPart: BodyPart) => ActionResult<Exercise>;
  updateSettings: (settings: UserSettings) => ActionResult<UserSettings>;
  exchangeGrowthPoints: (
    kind: FoodKind,
    amount?: number,
  ) => ActionResult<MasoStatus>;
  feedMaso: (kind: FoodKind, amount?: number) => ActionResult<MasoStatus>;
  renameMaso: (name: string) => ActionResult<MasoStatus>;
  clearLocalData: () => ActionResult<null>;
};

const initialState: DemoDataState = {
  version: 1,
  records: [],
  exercises: DEFAULT_EXERCISES,
  settings: { defaultSets: 3, weightUnit: "kg" },
  maso: {
    name: "マソ君",
    level: 1,
    experience: 0,
    growthPoints: 0,
    food: 0,
    protein: 0,
  },
};

const DemoDataContext = createContext<DemoDataContextValue | null>(null);

function mergeDefaultExercises(exercises: Exercise[]): Exercise[] {
  const userExercises = exercises.filter((exercise) => !exercise.isDefault);
  return [...DEFAULT_EXERCISES, ...userExercises];
}

function issueMap(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    fields[field] ??= issue.message;
  }

  return fields;
}

export function DemoDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoDataState>(initialState);
  const [isReady, setIsReady] = useState(false);
  const [storageIssue, setStorageIssue] = useState<string | null>(null);
  const canPersistRef = useRef(true);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);

      if (stored) {
        const parsed = persistedStateSchema.safeParse(JSON.parse(stored));

        if (parsed.success) {
          // This one-time effect intentionally hydrates React state from an
          // external browser store after server rendering has completed.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setState({
            ...parsed.data,
            exercises: mergeDefaultExercises(parsed.data.exercises),
          });
        } else {
          canPersistRef.current = false;
          setStorageIssue(
            "端末に保存されたデータを確認できなかったため、新しい状態で表示しています。元データは消していません。",
          );
        }
      }
    } catch {
      canPersistRef.current = false;
      setStorageIssue(
        "端末の保存領域を読み込めないため、新しい変更は保存できません。ブラウザの保存設定を確認してください。",
      );
    } finally {
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    if (!isReady || !canPersistRef.current) {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      canPersistRef.current = false;
      // Surface failures from the external storage system near the affected UI.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStorageIssue(
        "端末へ保存できませんでした。画面上の変更は再読み込みで消える可能性があります。",
      );
    }
  }, [isReady, state]);

  const addWorkout = useCallback(
    (draft: WorkoutDraft, clientRequestId: string): ActionResult<WorkoutRecord> => {
      if (!canPersistRef.current) {
        return {
          ok: false,
          message: "保存データを確認できないため、新しい変更は保存できません。メニューからプレビューデータを消去すると再開できます。",
        };
      }

      const parsed = workoutDraftSchema.safeParse(draft);

      if (!parsed.success) {
        return {
          ok: false,
          message: "入力内容を確認してください。",
          fieldErrors: issueMap(parsed.error),
        };
      }

      if (parsed.data.workoutDate > dateKeyInTimeZone()) {
        return { ok: false, message: "未来日の記録はまだ保存できません。" };
      }

      const duplicate = state.records.find(
        (record) => record.clientRequestId === clientRequestId,
      );

      if (duplicate) {
        return { ok: true, data: duplicate };
      }

      if (state.records.length >= MAX_LOCAL_RECORDS) {
        return {
          ok: false,
          message: "この端末に保存できる記録件数の上限に達しました。Supabase接続後に移行してください。",
        };
      }

      const exercise = state.exercises.find(
        (item) =>
          item.id === parsed.data.exerciseId &&
          item.bodyPart === parsed.data.bodyPart,
      );

      if (!exercise) {
        return {
          ok: false,
          message: "選択した種目を確認できませんでした。部位から選び直してください。",
        };
      }

      const volumeKg = calculateVolumeKg(
        parsed.data.weight,
        parsed.data.unit,
        parsed.data.reps,
        parsed.data.sets,
      );
      const weightKg = toKilograms(parsed.data.weight, parsed.data.unit);
      const record: WorkoutRecord = {
        id: crypto.randomUUID(),
        clientRequestId,
        workoutDate: parsed.data.workoutDate,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        bodyPart: exercise.bodyPart,
        weightKg,
        reps: parsed.data.reps,
        sets: parsed.data.sets,
        volumeKg,
        memo: parsed.data.memo,
        createdAt: new Date().toISOString(),
      };
      const rewards = rewardsFromVolume(volumeKg);
      const nextGrowthPoints = state.maso.growthPoints + rewards.growthPoints;

      if (!Number.isSafeInteger(nextGrowthPoints)) {
        return {
          ok: false,
          message: "育成値が保存可能な上限を超えるため、この記録は保存できません。",
        };
      }

      setState((current) => {
        if (
          current.records.some(
            (item) => item.clientRequestId === clientRequestId,
          )
        ) {
          return current;
        }

        return {
          ...current,
          records: [...current.records, record],
          maso: {
            ...current.maso,
            growthPoints: current.maso.growthPoints + rewards.growthPoints,
          },
        };
      });

      return { ok: true, data: record };
    },
    [
      state.exercises,
      state.maso.growthPoints,
      state.records,
    ],
  );

  const addExercise = useCallback(
    (name: string, bodyPart: BodyPart): ActionResult<Exercise> => {
      if (!canPersistRef.current) {
        return {
          ok: false,
          message: "保存データを確認できないため、種目を追加できません。",
        };
      }

      const normalizedName = name.trim().replace(/\s+/g, " ");

      if (!normalizedName || normalizedName.length > 60) {
        return {
          ok: false,
          message: "種目名は1〜60文字で入力してください。",
        };
      }

      const existing = state.exercises.find(
        (exercise) =>
          exercise.bodyPart === bodyPart &&
          exercise.name.toLocaleLowerCase("ja-JP") ===
            normalizedName.toLocaleLowerCase("ja-JP"),
      );

      if (existing) {
        return { ok: true, data: existing };
      }

      if (state.exercises.length >= MAX_LOCAL_EXERCISES) {
        return {
          ok: false,
          message: "この端末に保存できる種目数の上限に達しました。",
        };
      }

      const exercise: Exercise = {
        id: `local-${crypto.randomUUID()}`,
        name: normalizedName,
        bodyPart,
        isDefault: false,
      };

      setState((current) => ({
        ...current,
        exercises: [...current.exercises, exercise],
      }));

      return { ok: true, data: exercise };
    },
    [state.exercises],
  );

  const updateSettings = useCallback(
    (settings: UserSettings): ActionResult<UserSettings> => {
      if (!canPersistRef.current) {
        return { ok: false, message: "保存データを確認できないため、設定を変更できません。" };
      }

      const parsed = userSettingsSchema.safeParse(settings);

      if (!parsed.success) {
        return { ok: false, message: "設定値を確認してください。" };
      }

      setState((current) => ({ ...current, settings: parsed.data }));
      return { ok: true, data: parsed.data };
    },
    [],
  );

  const exchangeGrowthPoints = useCallback(
    (kind: FoodKind, amount = 1): ActionResult<MasoStatus> => {
      if (!canPersistRef.current) {
        return { ok: false, message: "保存データを確認できないため、交換できません。" };
      }

      const exchangeAmount = Math.floor(amount);
      const item = FOOD_ITEMS[kind];
      const totalCost = exchangeAmount * item.growthPointCost;

      if (
        exchangeAmount < 1 ||
        exchangeAmount > MAX_ITEM_ACTION_AMOUNT ||
        !Number.isSafeInteger(totalCost) ||
        state.maso.growthPoints < totalCost
      ) {
        return { ok: false, message: "育成ポイントが足りません。" };
      }

      const inventoryKey = kind === "onigiri" ? "food" : "protein";
      const nextInventory = state.maso[inventoryKey] + exchangeAmount;

      if (!Number.isSafeInteger(nextInventory)) {
        return { ok: false, message: "これ以上アイテムを所持できません。" };
      }

      const nextMaso = {
        ...state.maso,
        growthPoints: state.maso.growthPoints - totalCost,
        [inventoryKey]: nextInventory,
      };

      setState((current) => ({ ...current, maso: nextMaso }));
      return { ok: true, data: nextMaso };
    },
    [state.maso],
  );

  const feedMaso = useCallback(
    (kind: FoodKind, amount = 1): ActionResult<MasoStatus> => {
      if (!canPersistRef.current) {
        return { ok: false, message: "保存データを確認できないため、エサを使えません。" };
      }

      const useAmount = Math.floor(amount);
      const inventoryKey = kind === "onigiri" ? "food" : "protein";
      const item = FOOD_ITEMS[kind];

      if (
        useAmount < 1 ||
        useAmount > MAX_ITEM_ACTION_AMOUNT ||
        state.maso[inventoryKey] < useAmount
      ) {
        return { ok: false, message: `${item.name}が足りません。育成ポイントと交換できます。` };
      }

      const nextExperience = applyExperience(
        state.maso.level,
        state.maso.experience,
        useAmount * item.experience,
      );
      const nextMaso = {
        ...state.maso,
        level: nextExperience.level,
        experience: nextExperience.experience,
        [inventoryKey]: state.maso[inventoryKey] - useAmount,
      };

      setState((current) => ({ ...current, maso: nextMaso }));
      return { ok: true, data: nextMaso };
    },
    [state.maso],
  );

  const renameMaso = useCallback(
    (name: string): ActionResult<MasoStatus> => {
      if (!canPersistRef.current) {
        return { ok: false, message: "保存データを確認できないため、名前を変更できません。" };
      }

      const parsed = z.string().trim().min(1).max(30).safeParse(name);

      if (!parsed.success) {
        return { ok: false, message: "名前は1〜30文字で入力してください。" };
      }

      const nextMaso = { ...state.maso, name: parsed.data };
      setState((current) => ({ ...current, maso: nextMaso }));
      return { ok: true, data: nextMaso };
    },
    [state.maso],
  );

  const clearLocalData = useCallback((): ActionResult<null> => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      canPersistRef.current = true;
      setState(initialState);
      setStorageIssue(null);
      return { ok: true, data: null };
    } catch {
      setStorageIssue("端末内のデータを消去できませんでした。ブラウザの保存設定を確認してください。");
      return { ok: false, message: "プレビューデータを消去できませんでした。" };
    }
  }, []);

  const value = useMemo<DemoDataContextValue>(
    () => ({
      ...state,
      isReady,
      storageIssue,
      addWorkout,
      addExercise,
      updateSettings,
      exchangeGrowthPoints,
      feedMaso,
      renameMaso,
      clearLocalData,
    }),
    [
      addExercise,
      addWorkout,
      clearLocalData,
      exchangeGrowthPoints,
      feedMaso,
      isReady,
      renameMaso,
      state,
      storageIssue,
      updateSettings,
    ],
  );

  return (
    <DemoDataContext.Provider value={value}>
      {children}
    </DemoDataContext.Provider>
  );
}

export function useDemoData(): DemoDataContextValue {
  const context = useContext(DemoDataContext);

  if (!context) {
    throw new Error("useDemoData must be used within DemoDataProvider");
  }

  return context;
}
