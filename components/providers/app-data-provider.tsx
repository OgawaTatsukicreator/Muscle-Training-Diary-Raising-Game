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
import { usePathname, useRouter } from "next/navigation";
import { z } from "zod";

import {
  DemoDataProvider,
  useDemoData,
  type ActionResult,
  type DemoDataContextValue,
  type DemoDataState,
  type MasoStatus,
} from "@/components/providers/demo-data-provider";
import {
  bodyWeightEntrySchema,
  latestBodyWeightKg,
  upsertBodyWeight,
  type BodyWeightEntry,
} from "@/lib/domain/body-weight";
import { dateKeyInTimeZone } from "@/lib/domain/date";
import {
  DEFAULT_DISPLAY_NAME,
  DEFAULT_MASO_NAME,
  displayNameFieldSchema,
  storedNameSchema,
} from "@/lib/domain/display-name";
import { describeRpcError, settle } from "@/lib/errors/rpc-error";
import { foodFailure } from "@/lib/errors/food-error";
import { workoutFailure } from "@/lib/errors/workout-error";
import {
  EMPTY_FOOD_ITEMS,
  isValidItemActionAmount,
  type FoodItems,
  type FoodKind,
} from "@/lib/domain/growth";
import {
  CALCULATION_PATTERNS,
  type CustomExerciseOptions,
} from "@/lib/domain/load";
import { evaluateWorkoutDraft } from "@/lib/domain/workout-load";
import {
  bodyPartSchema,
  exerciseSchema,
  userSettingsSchema,
  workoutDraftSchema,
  workoutRecordSchema,
  type BodyPart,
  type Exercise,
  type UserSettings,
  type WorkoutDraft,
  type WorkoutRecord,
} from "@/lib/domain/workout";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";

type SupabaseBrowserClient = NonNullable<
  ReturnType<typeof createBrowserSupabaseClient>
>;

export type AppProfile = {
  displayName: string;
};

export type StorageMode = "loading" | "local" | "supabase" | "signed-out";

type AsyncDataActions = {
  addWorkout: (
    draft: WorkoutDraft,
    clientRequestId: string,
  ) => Promise<ActionResult<WorkoutRecord>>;
  updateWorkout: (
    workoutId: string,
    draft: WorkoutDraft,
    clientRequestId: string,
  ) => Promise<ActionResult<WorkoutRecord>>;
  deleteWorkout: (
    workoutId: string,
    clientRequestId: string,
  ) => Promise<ActionResult<{ growthPointsDelta: number }>>;
  addExercise: (
    name: string,
    bodyPart: BodyPart,
    options?: CustomExerciseOptions,
  ) => Promise<ActionResult<Exercise>>;
  saveBodyWeight: (
    date: string,
    weightKg: number,
  ) => Promise<ActionResult<BodyWeightEntry>>;
  updateSettings: (
    settings: UserSettings,
  ) => Promise<ActionResult<UserSettings>>;
  exchangeGrowthPoints: (
    kind: FoodKind,
    amount: number,
    clientRequestId: string,
  ) => Promise<ActionResult<MasoStatus>>;
  feedMaso: (
    kind: FoodKind,
    amount: number,
    clientRequestId: string,
  ) => Promise<ActionResult<MasoStatus>>;
  renameMaso: (name: string) => Promise<ActionResult<MasoStatus>>;
  clearLocalData: () => Promise<ActionResult<null>>;
  updateProfile: (displayName: string) => Promise<ActionResult<AppProfile>>;
};

export type AppDataContextValue = Omit<
  DemoDataContextValue,
  keyof AsyncDataActions
> &
  AsyncDataActions & {
    profile: AppProfile;
    storageMode: StorageMode;
    retryStorage: () => Promise<void>;
  };

type CloudDataState = DemoDataState & {
  profile: AppProfile;
};

const EMPTY_CLOUD_STATE: CloudDataState = {
  version: 1,
  profile: { displayName: "トレーニー" },
  records: [],
  exercises: [],
  bodyWeights: [],
  settings: { defaultSets: 3, weightUnit: "kg" },
  maso: {
    name: "マソ君",
    level: 1,
    experience: 0,
    growthPoints: 0,
    food: 0,
    protein: 0,
    items: { ...EMPTY_FOOD_ITEMS },
  },
};

const profileRowSchema = z.object({
  display_name: storedNameSchema(DEFAULT_DISPLAY_NAME),
});

const settingsRowSchema = z.object({
  default_sets: z.number().int().min(1).max(20),
  weight_unit: z.enum(["kg", "lb"]),
});

const exerciseRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  body_part: bodyPartSchema,
  is_default: z.boolean(),
  calculation_pattern: z.enum(CALCULATION_PATTERNS),
  bw_ratio: z.coerce.number().finite().min(0).max(1),
  is_isometric: z.boolean(),
});

// PostgREST returns numeric columns as numbers or strings, and NULL as null.
const nullableNumericSchema = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((value) => (value === null ? null : Number(value)))
  .pipe(z.number().finite().nullable());

const bodyWeightRowSchema = z.object({
  log_date: z.string(),
  weight_kg: z.coerce.number().finite(),
});

const addExerciseResultSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  bodyPart: bodyPartSchema,
  isDefault: z.boolean(),
  calculationPattern: z.enum(CALCULATION_PATTERNS),
  bwRatio: z.coerce.number().finite().min(0).max(1),
  isIsometric: z.boolean(),
});

const saveBodyWeightResultSchema = z.object({
  date: z.string(),
  weightKg: z.coerce.number().finite(),
});

const databaseDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

const workoutRowSchema = z.object({
  id: z.string().uuid(),
  client_request_id: z.string().uuid(),
  workout_date: z.string(),
  exercise_id: z.string().uuid(),
  weight_kg: z.coerce.number().finite().min(0).max(2000),
  reps: z.number().int().min(1).max(1000),
  sets: z.number().int().min(1).max(100),
  volume_kg: z.coerce.number().finite().min(0).max(200_000_000),
  body_weight_kg: nullableNumericSchema,
  assist_kg: z.coerce.number().finite().min(0),
  load_per_unit_kg: z.coerce.number().finite().min(0),
  memo: z.string().max(500),
  created_at: databaseDateTimeSchema,
});

const masoRowSchema = z.object({
  maso_name: storedNameSchema(DEFAULT_MASO_NAME),
  level: z.number().int().min(1).max(999),
  experience: z.number().int().min(0).max(99_900),
  growth_points: z.number().int().min(0),
});

const foodRowSchema = z.object({
  balance: z.number().int().min(0),
  protein_balance: z.number().int().min(0),
});

const foodInventoryRowSchema = z.object({
  kind: z.enum(["banana", "chicken", "steak"]),
  balance: z.number().int().min(0),
});

// RPC結果の items。古いサーバー(0007未適用)では無いので0で補う
const foodItemsSchema = z
  .object({
    banana: z.number().int().min(0).default(0),
    chicken: z.number().int().min(0).default(0),
    steak: z.number().int().min(0).default(0),
  })
  .default({ ...EMPTY_FOOD_ITEMS });

function foodItemsFromRows(
  rows: { kind: "banana" | "chicken" | "steak"; balance: number }[],
): FoodItems {
  const items: FoodItems = { ...EMPTY_FOOD_ITEMS };

  for (const row of rows) {
    items[row.kind] = row.balance;
  }

  return items;
}

const saveWorkoutResultSchema = z.object({
  id: z.string().uuid(),
  volumeKg: z.coerce.number().finite().min(0),
  loadPerUnitKg: z.coerce.number().finite().min(0),
  bodyWeightKg: nullableNumericSchema.optional(),
  growthPoints: z.number().int().min(0),
  food: z.number().int().min(0),
  created: z.boolean(),
});

const updateWorkoutResultSchema = z.object({
  id: z.string().uuid(),
  volumeKg: z.coerce.number().finite().min(0),
  loadPerUnitKg: z.coerce.number().finite().min(0),
  bodyWeightKg: nullableNumericSchema.optional(),
  growthPoints: z.number().int().min(0),
  growthPointsDelta: z.number().int(),
  created: z.boolean(),
});

const deleteWorkoutResultSchema = z.object({
  id: z.string().uuid(),
  growthPointsDelta: z.number().int(),
  created: z.boolean(),
});

const renameMasoResultSchema = z.object({
  name: storedNameSchema(DEFAULT_MASO_NAME),
});

const updateDisplayNameResultSchema = z.object({
  displayName: storedNameSchema(DEFAULT_DISPLAY_NAME),
});

const itemInventoryResultSchema = z.object({
  growthPoints: z.number().int().min(0),
  food: z.number().int().min(0),
  protein: z.number().int().min(0),
  items: foodItemsSchema,
  created: z.boolean(),
});

const feedMasoItemResultSchema = z.object({
  level: z.number().int().min(1).max(999),
  experience: z.number().int().min(0).max(99_900),
  food: z.number().int().min(0),
  protein: z.number().int().min(0),
  items: foodItemsSchema,
  created: z.boolean(),
});

const AppDataContext = createContext<AppDataContextValue | null>(null);
const CLOUD_PAGE_SIZE = 500;
// 直近の体重のみ取得する(PostgRESTの既定上限1000行に合わせる)
const CLOUD_BODY_WEIGHT_LIMIT = 1000;

type CloudPageCursor = {
  createdAt: string;
  id: string;
};

function isProtectedPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/records" ||
    pathname.startsWith("/records/") ||
    pathname === "/analytics" ||
    pathname.startsWith("/analytics/")
  );
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    errors[field] ??= issue.message;
  }

  return errors;
}

function cloudFailure(message: string): ActionResult<never> {
  return { ok: false, message };
}

async function loadAllExerciseRows(
  supabase: SupabaseBrowserClient,
  userId: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let cursor: CloudPageCursor | null = null;

  for (;;) {
    let query = supabase
      .from("exercises")
      .select(
        "id, name, body_part, is_default, calculation_pattern, bw_ratio, is_isometric, created_at",
      )
      .eq("user_id", userId)
      .order("created_at")
      .order("id")
      .limit(CLOUD_PAGE_SIZE);

    if (cursor) {
      query = query.or(
        `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
      );
    }

    const { data, error } = await query;

    if (error) {
      throw new Error("Supabase exercise request failed");
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length < CLOUD_PAGE_SIZE) {
      return rows;
    }

    const last = z
      .object({ id: z.string().uuid(), created_at: z.string() })
      .parse(page.at(-1));
    cursor = { id: last.id, createdAt: last.created_at };
  }
}

async function loadAllWorkoutRows(
  supabase: SupabaseBrowserClient,
  userId: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  let cursor: CloudPageCursor | null = null;

  for (;;) {
    let query = supabase
      .from("workout_logs")
      .select(
        "id, client_request_id, workout_date, exercise_id, weight_kg, reps, sets, volume_kg, body_weight_kg, assist_kg, load_per_unit_kg, memo, created_at",
      )
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at")
      .order("id")
      .limit(CLOUD_PAGE_SIZE);

    if (cursor) {
      query = query.or(
        `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
      );
    }

    const { data, error } = await query;

    if (error) {
      throw new Error("Supabase workout request failed");
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length < CLOUD_PAGE_SIZE) {
      return rows;
    }

    const last = z
      .object({ id: z.string().uuid(), created_at: z.string() })
      .parse(page.at(-1));
    cursor = { id: last.id, createdAt: last.created_at };
  }
}

async function loadCloudData(
  supabase: SupabaseBrowserClient,
  userId: string,
): Promise<CloudDataState> {
  const [
    profileResult,
    settingsResult,
    exerciseRowsResult,
    workoutRowsResult,
    masoResult,
    foodResult,
    bodyWeightResult,
    inventoryResult,
  ] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name")
        .eq("id", userId)
        .single(),
      supabase
        .from("user_settings")
        .select("default_sets, weight_unit")
        .eq("user_id", userId)
        .single(),
      loadAllExerciseRows(supabase, userId),
      loadAllWorkoutRows(supabase, userId),
      supabase
        .from("maso_status")
        .select("maso_name, level, experience, growth_points")
        .eq("user_id", userId)
        .single(),
      supabase
        .from("foods")
        .select("balance, protein_balance")
        .eq("user_id", userId)
        .single(),
      supabase
        .from("body_weight_logs")
        .select("log_date, weight_kg")
        .eq("user_id", userId)
        .order("log_date", { ascending: false })
        .limit(CLOUD_BODY_WEIGHT_LIMIT),
      supabase
        .from("food_inventory")
        .select("kind, balance")
        .eq("user_id", userId),
    ]);

  const firstError = [
    profileResult.error,
    settingsResult.error,
    masoResult.error,
    foodResult.error,
    bodyWeightResult.error,
    inventoryResult.error,
  ].find(Boolean);

  if (firstError) {
    throw new Error("Supabase data request failed");
  }

  const profileRow = profileRowSchema.parse(profileResult.data);
  const settingsRow = settingsRowSchema.parse(settingsResult.data);
  const exerciseRows = z.array(exerciseRowSchema).parse(exerciseRowsResult);
  const workoutRows = z.array(workoutRowSchema).parse(workoutRowsResult);
  const masoRow = masoRowSchema.parse(masoResult.data);
  const foodRow = foodRowSchema.parse(foodResult.data);
  const foodItems = foodItemsFromRows(
    z.array(foodInventoryRowSchema).parse(inventoryResult.data ?? []),
  );
  const bodyWeights = z
    .array(bodyWeightRowSchema)
    .parse(bodyWeightResult.data ?? [])
    .map((row) =>
      bodyWeightEntrySchema.parse({ date: row.log_date, weightKg: row.weight_kg }),
    )
    .reverse();
  const exercises = exerciseRows.map((row) =>
    exerciseSchema.parse({
      id: row.id,
      name: row.name,
      bodyPart: row.body_part,
      isDefault: row.is_default,
      calculationPattern: row.calculation_pattern,
      bwRatio: row.bw_ratio,
      isIsometric: row.is_isometric,
    }),
  );
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const records = workoutRows.map((row) => {
    const exercise = exerciseById.get(row.exercise_id);

    if (!exercise) {
      throw new Error("Workout exercise is unavailable");
    }

    return workoutRecordSchema.parse({
      id: row.id,
      clientRequestId: row.client_request_id,
      workoutDate: row.workout_date,
      exerciseId: row.exercise_id,
      exerciseName: exercise.name,
      bodyPart: exercise.bodyPart,
      weightKg: row.weight_kg,
      reps: row.reps,
      sets: row.sets,
      volumeKg: row.volume_kg,
      bodyWeightKg: row.body_weight_kg,
      assistKg: row.assist_kg,
      loadPerUnitKg: row.load_per_unit_kg,
      memo: row.memo,
      createdAt: row.created_at,
    });
  });

  return {
    version: 1,
    profile: { displayName: profileRow.display_name },
    records,
    exercises,
    bodyWeights,
    settings: userSettingsSchema.parse({
      defaultSets: settingsRow.default_sets,
      weightUnit: settingsRow.weight_unit,
    }),
    maso: {
      name: masoRow.maso_name,
      level: masoRow.level,
      experience: masoRow.experience,
      growthPoints: masoRow.growth_points,
      food: foodRow.balance,
      protein: foodRow.protein_balance,
      items: foodItems,
    },
  };
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  return (
    <DemoDataProvider>
      <AppDataBridge>{children}</AppDataBridge>
    </DemoDataProvider>
  );
}

function AppDataBridge({ children }: { children: ReactNode }) {
  const local = useDemoData();
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const [authState, setAuthState] = useState<{
    checked: boolean;
    userId: string | null;
  }>(() => ({ checked: !supabase, userId: null }));
  const [cloudState, setCloudState] = useState<CloudDataState>(EMPTY_CLOUD_STATE);
  const [loadedCloudUserId, setLoadedCloudUserId] = useState<string | null>(null);
  const [cloudIssue, setCloudIssue] = useState<string | null>(null);
  const [cloudIssueUserId, setCloudIssueUserId] = useState<string | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const cloudReady = Boolean(
    authState.userId && loadedCloudUserId === authState.userId,
  );

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        const userId = data.session?.user.id ?? null;
        activeUserIdRef.current = userId;
        setAuthState({ checked: true, userId });
      }
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) {
        const userId = session?.user.id ?? null;
        activeUserIdRef.current = userId;
        setAuthState({ checked: true, userId });
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (
      supabase &&
      authState.checked &&
      !authState.userId &&
      isProtectedPath(pathname)
    ) {
      const nextPath = `${window.location.pathname}${window.location.search}`;
      router.replace(
        `/login?next=${encodeURIComponent(nextPath)}&status=session-expired`,
      );
    }
  }, [authState.checked, authState.userId, pathname, router, supabase]);

  const refreshCloudData = useCallback(async () => {
    if (!supabase || !authState.userId) {
      return null;
    }

    const requestedUserId = authState.userId;

    try {
      const nextState = await loadCloudData(supabase, requestedUserId);
      if (activeUserIdRef.current !== requestedUserId) {
        return null;
      }

      setCloudState(nextState);
      setLoadedCloudUserId(requestedUserId);
      setCloudIssue(null);
      setCloudIssueUserId(null);
      return nextState;
    } catch {
      if (activeUserIdRef.current !== requestedUserId) {
        return null;
      }

      setLoadedCloudUserId(null);
      setCloudIssue(
        "クラウドのデータを読み込めませんでした。通信状態を確認して、もう一度読み込んでください。",
      );
      setCloudIssueUserId(requestedUserId);
      return null;
    }
  }, [authState.userId, supabase]);

  useEffect(() => {
    if (!authState.checked) {
      return;
    }

    if (!supabase || !authState.userId) {
      return;
    }

    let active = true;
    const loadingUserId = authState.userId;

    void loadCloudData(supabase, loadingUserId)
      .then((nextState) => {
        if (active) {
          setCloudState(nextState);
          setLoadedCloudUserId(loadingUserId);
          setCloudIssue(null);
          setCloudIssueUserId(null);
        }
      })
      .catch(() => {
        if (active) {
          setLoadedCloudUserId(null);
          setCloudIssue(
            "クラウドのデータを読み込めませんでした。通信状態を確認して、もう一度読み込んでください。",
          );
          setCloudIssueUserId(loadingUserId);
        }
      });

    return () => {
      active = false;
    };
  }, [authState.checked, authState.userId, supabase]);

  const storageMode: StorageMode = !authState.checked
    ? "loading"
    : !supabase
      ? "local"
      : authState.userId
        ? "supabase"
        : "signed-out";
  const usingCloud = storageMode === "supabase";
  const usingLocal = storageMode === "local";
  const activeState =
    storageMode === "loading"
      ? EMPTY_CLOUD_STATE
      : usingCloud
        ? cloudReady
          ? cloudState
          : EMPTY_CLOUD_STATE
        : usingLocal
          ? local
          : EMPTY_CLOUD_STATE;
  const isReady = authState.checked && (usingCloud ? cloudReady : usingLocal && local.isReady);

  const retryStorage = useCallback(async () => {
    if (!usingCloud || !authState.userId) {
      return;
    }

    setLoadedCloudUserId(null);
    setCloudIssue(null);
    setCloudIssueUserId(null);
    await refreshCloudData();
  }, [authState.userId, refreshCloudData, usingCloud]);

  const addWorkout = useCallback(
    async (
      draft: WorkoutDraft,
      clientRequestId: string,
    ): Promise<ActionResult<WorkoutRecord>> => {
      if (usingLocal) {
        return local.addWorkout(draft, clientRequestId);
      }

      if (!supabase || !authState.userId || !cloudReady) {
        return cloudFailure("クラウドへの接続を確認しています。少し待ってからお試しください。");
      }
      const operationUserId = authState.userId;

      const parsed = workoutDraftSchema.safeParse(draft);
      if (!parsed.success) {
        return {
          ok: false,
          message: "入力内容を確認してください。",
          fieldErrors: fieldErrors(parsed.error),
        };
      }

      if (parsed.data.workoutDate > dateKeyInTimeZone()) {
        return cloudFailure("未来日の記録はまだ保存できません。");
      }

      const exercise = cloudState.exercises.find(
        (item) =>
          item.id === parsed.data.exerciseId &&
          item.bodyPart === parsed.data.bodyPart,
      );
      if (!exercise) {
        return cloudFailure("選択した種目を確認できませんでした。部位から選び直してください。");
      }

      const evaluation = evaluateWorkoutDraft(
        parsed.data,
        exercise,
        latestBodyWeightKg(cloudState.bodyWeights, parsed.data.workoutDate),
      );
      if (!evaluation.ok) {
        return {
          ok: false,
          message: "入力内容を確認してください。",
          fieldErrors: evaluation.fieldErrors,
        };
      }

      const { data, error } = await settle(() =>
        supabase.rpc("save_workout", {
          p_exercise_id: parsed.data.exerciseId,
          p_workout_date: parsed.data.workoutDate,
          p_weight: parsed.data.weight,
          p_unit: parsed.data.unit,
          p_reps: parsed.data.reps,
          p_sets: parsed.data.sets,
          p_memo: parsed.data.memo,
          p_request_id: clientRequestId,
          p_body_weight_kg: parsed.data.bodyWeightKg,
          p_assist: parsed.data.assist,
        }),
      );

      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }

      if (error) {
        const failure = workoutFailure(error);
        return { ok: false, message: failure.message, fieldErrors: failure.fieldErrors };
      }

      const result = saveWorkoutResultSchema.safeParse(data);
      if (!result.success) {
        return cloudFailure("保存結果を確認できませんでした。ページを再読み込みしてください。");
      }

      const latest = await refreshCloudData();
      const saved = latest?.records.find((record) => record.id === result.data.id);

      if (saved) {
        return { ok: true, data: saved };
      }

      const fallbackRecord = workoutRecordSchema.safeParse({
        id: result.data.id,
        clientRequestId,
        workoutDate: parsed.data.workoutDate,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        bodyPart: exercise.bodyPart,
        weightKg: evaluation.value.weightKg,
        reps: parsed.data.reps,
        sets: parsed.data.sets,
        volumeKg: result.data.volumeKg,
        bodyWeightKg: result.data.bodyWeightKg ?? evaluation.value.bodyWeightKg,
        assistKg: evaluation.value.assistKg,
        loadPerUnitKg: result.data.loadPerUnitKg,
        memo: parsed.data.memo.trim(),
        createdAt: new Date().toISOString(),
      });

      return fallbackRecord.success
        ? { ok: true, data: fallbackRecord.data }
        : cloudFailure("記録は保存されました。最新の内容を表示するにはページを再読み込みしてください。");
    },
    [
      authState.userId,
      cloudReady,
      cloudState.bodyWeights,
      cloudState.exercises,
      local,
      refreshCloudData,
      supabase,
      usingLocal,
    ],
  );

  const updateWorkout = useCallback(
    async (
      workoutId: string,
      draft: WorkoutDraft,
      clientRequestId: string,
    ): Promise<ActionResult<WorkoutRecord>> => {
      if (usingLocal) {
        return local.updateWorkout(workoutId, draft, clientRequestId);
      }

      if (!supabase || !authState.userId || !cloudReady) {
        return cloudFailure("クラウドへの接続を確認しています。少し待ってからお試しください。");
      }
      const operationUserId = authState.userId;

      const parsed = workoutDraftSchema.safeParse(draft);
      if (!parsed.success) {
        return {
          ok: false,
          message: "入力内容を確認してください。",
          fieldErrors: fieldErrors(parsed.error),
        };
      }

      if (parsed.data.workoutDate > dateKeyInTimeZone()) {
        return cloudFailure("未来日の記録はまだ保存できません。");
      }

      const current = cloudState.records.find((record) => record.id === workoutId);
      const exercise = current
        ? cloudState.exercises.find((item) => item.id === current.exerciseId)
        : undefined;
      if (!current || !exercise) {
        return cloudFailure(
          "記録が見つかりませんでした。すでに削除された可能性があります。記録の一覧を開き直してください。",
        );
      }

      const evaluation = evaluateWorkoutDraft(
        parsed.data,
        exercise,
        latestBodyWeightKg(cloudState.bodyWeights, parsed.data.workoutDate),
      );
      if (!evaluation.ok) {
        return {
          ok: false,
          message: "入力内容を確認してください。",
          fieldErrors: evaluation.fieldErrors,
        };
      }

      const { data, error } = await settle(() =>
        supabase.rpc("update_workout", {
          p_workout_id: workoutId,
          p_workout_date: parsed.data.workoutDate,
          p_weight: parsed.data.weight,
          p_unit: parsed.data.unit,
          p_reps: parsed.data.reps,
          p_sets: parsed.data.sets,
          p_memo: parsed.data.memo,
          p_request_id: clientRequestId,
          p_body_weight_kg: parsed.data.bodyWeightKg,
          p_assist: parsed.data.assist,
        }),
      );

      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }

      if (error) {
        const failure = workoutFailure(error);
        return { ok: false, message: failure.message, fieldErrors: failure.fieldErrors };
      }

      const result = updateWorkoutResultSchema.safeParse(data);
      if (!result.success) {
        return cloudFailure("保存結果を確認できませんでした。ページを再読み込みしてください。");
      }

      // 育成ポイントなどの最新値はサーバーの結果が正本。取り直して画面へ反映する
      const latest = await refreshCloudData();
      const saved = latest?.records.find((record) => record.id === workoutId);

      return saved
        ? { ok: true, data: saved }
        : cloudFailure(
            "変更は保存されました。最新の内容を表示するにはページを再読み込みしてください。",
          );
    },
    [
      authState.userId,
      cloudReady,
      cloudState.bodyWeights,
      cloudState.exercises,
      cloudState.records,
      local,
      refreshCloudData,
      supabase,
      usingLocal,
    ],
  );

  const deleteWorkout = useCallback(
    async (
      workoutId: string,
      clientRequestId: string,
    ): Promise<ActionResult<{ growthPointsDelta: number }>> => {
      if (usingLocal) {
        return local.deleteWorkout(workoutId, clientRequestId);
      }

      if (!supabase || !authState.userId || !cloudReady) {
        return cloudFailure("クラウドへの接続を確認しています。少し待ってからお試しください。");
      }
      const operationUserId = authState.userId;

      const { data, error } = await settle(() =>
        supabase.rpc("delete_workout", {
          p_workout_id: workoutId,
          p_request_id: clientRequestId,
        }),
      );

      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }

      if (error) {
        // すでに別の端末などで削除されていた場合は、一覧を最新にして成功として扱う
        if (/workout not found/i.test(String((error as { message?: string }).message ?? ""))) {
          await refreshCloudData();
          return { ok: true, data: { growthPointsDelta: 0 } };
        }

        return cloudFailure(workoutFailure(error).message);
      }

      const result = deleteWorkoutResultSchema.safeParse(data);
      if (!result.success) {
        await refreshCloudData();
        return cloudFailure("削除結果を確認できませんでした。記録の一覧を確認してください。");
      }

      await refreshCloudData();
      return { ok: true, data: { growthPointsDelta: result.data.growthPointsDelta } };
    },
    [authState.userId, cloudReady, local, refreshCloudData, supabase, usingLocal],
  );

  const addExercise = useCallback(
    async (
      name: string,
      bodyPart: BodyPart,
      options?: CustomExerciseOptions,
    ): Promise<ActionResult<Exercise>> => {
      if (usingLocal) {
        return local.addExercise(name, bodyPart, options);
      }

      if (!supabase || !authState.userId || !cloudReady) {
        return cloudFailure("クラウドへの接続を確認しています。少し待ってからお試しください。");
      }
      const operationUserId = authState.userId;

      const normalizedName = name.trim().replace(/\s+/g, " ");
      const parsed = exerciseSchema.safeParse({
        id: crypto.randomUUID(),
        name: normalizedName,
        bodyPart,
        isDefault: false,
      });
      if (!parsed.success) {
        return cloudFailure("種目名は1〜60文字で入力してください。");
      }

      const existing = cloudState.exercises.find(
        (exercise) =>
          exercise.bodyPart === bodyPart &&
          exercise.name.toLocaleLowerCase("ja-JP") ===
            normalizedName.toLocaleLowerCase("ja-JP"),
      );
      if (existing) {
        return { ok: true, data: existing };
      }

      // 換算パターンは部位と質問への回答からサーバー側で決まる
      const { data, error } = await settle(() =>
        supabase.rpc("add_exercise", {
          p_name: normalizedName,
          p_body_part: bodyPart,
          p_uses_bodyweight: options?.usesBodyweight === true,
          p_is_isometric: options?.isIsometric === true,
        }),
      );

      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }

      if (error) {
        return cloudFailure(describeRpcError(error, "種目名"));
      }

      const row = addExerciseResultSchema.safeParse(data);
      if (!row.success) {
        return cloudFailure("追加した種目を確認できませんでした。ページを再読み込みしてください。");
      }

      const exercise = exerciseSchema.parse({
        id: row.data.id,
        name: row.data.name,
        bodyPart: row.data.bodyPart,
        isDefault: row.data.isDefault,
        calculationPattern: row.data.calculationPattern,
        bwRatio: row.data.bwRatio,
        isIsometric: row.data.isIsometric,
      });
      setCloudState((current) => ({
        ...current,
        exercises: current.exercises.some((item) => item.id === exercise.id)
          ? current.exercises
          : [...current.exercises, exercise],
      }));
      setCloudIssue(null);
      return { ok: true, data: exercise };
    },
    [
      authState.userId,
      cloudReady,
      cloudState.exercises,
      local,
      supabase,
      usingLocal,
    ],
  );

  const saveBodyWeight = useCallback(
    async (
      date: string,
      weightKg: number,
    ): Promise<ActionResult<BodyWeightEntry>> => {
      if (usingLocal) {
        return local.saveBodyWeight(date, weightKg);
      }

      if (!supabase || !authState.userId || !cloudReady) {
        return cloudFailure("クラウドへの接続を確認しています。少し待ってからお試しください。");
      }
      const operationUserId = authState.userId;

      const parsed = bodyWeightEntrySchema.safeParse({ date, weightKg });
      if (!parsed.success) {
        return cloudFailure("体重は20〜300kgで入力してください。");
      }

      if (parsed.data.date > dateKeyInTimeZone()) {
        return cloudFailure("未来日の体重は記録できません。");
      }

      const { data, error } = await settle(() =>
        supabase.rpc("save_body_weight", {
          p_log_date: parsed.data.date,
          p_weight_kg: parsed.data.weightKg,
        }),
      );

      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }

      if (error) {
        return cloudFailure(describeRpcError(error, "体重"));
      }

      const result = saveBodyWeightResultSchema.safeParse(data);
      const entry = result.success
        ? bodyWeightEntrySchema.safeParse({
            date: result.data.date,
            weightKg: result.data.weightKg,
          })
        : null;
      if (!entry?.success) {
        return cloudFailure("保存した体重を確認できませんでした。ページを再読み込みしてください。");
      }

      setCloudState((current) => ({
        ...current,
        bodyWeights: upsertBodyWeight(current.bodyWeights, entry.data),
      }));
      setCloudIssue(null);
      return { ok: true, data: entry.data };
    },
    [authState.userId, cloudReady, local, supabase, usingLocal],
  );

  const updateSettings = useCallback(
    async (settings: UserSettings): Promise<ActionResult<UserSettings>> => {
      if (usingLocal) {
        return local.updateSettings(settings);
      }

      if (!supabase || !authState.userId || !cloudReady) {
        return cloudFailure("クラウドへの接続を確認しています。少し待ってからお試しください。");
      }
      const operationUserId = authState.userId;

      const parsed = userSettingsSchema.safeParse(settings);
      if (!parsed.success) {
        return cloudFailure("設定値を確認してください。");
      }

      const { data, error } = await supabase
        .from("user_settings")
        .update({
          default_sets: parsed.data.defaultSets,
          weight_unit: parsed.data.weightUnit,
        })
        .eq("user_id", authState.userId)
        .select("default_sets, weight_unit")
        .single();

      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }

      if (error) {
        return cloudFailure("設定をクラウドへ保存できませんでした。もう一度お試しください。");
      }

      const row = settingsRowSchema.safeParse(data);
      if (!row.success) {
        return cloudFailure("保存した設定を確認できませんでした。ページを再読み込みしてください。");
      }

      const nextSettings = userSettingsSchema.parse({
        defaultSets: row.data.default_sets,
        weightUnit: row.data.weight_unit,
      });
      setCloudState((current) => ({ ...current, settings: nextSettings }));
      setCloudIssue(null);
      return { ok: true, data: nextSettings };
    },
    [authState.userId, cloudReady, local, supabase, usingLocal],
  );

  const exchangeGrowthPoints = useCallback(
    async (
      kind: FoodKind,
      amount: number,
      clientRequestId: string,
    ): Promise<ActionResult<MasoStatus>> => {
      if (usingLocal) {
        return local.exchangeGrowthPoints(kind, amount);
      }

      if (!supabase || !authState.userId || !cloudReady) {
        return cloudFailure("クラウドへの接続を確認しています。少し待ってからお試しください。");
      }
      const operationUserId = authState.userId;

      if (
        !isValidItemActionAmount(amount) ||
        !z.string().uuid().safeParse(clientRequestId).success
      ) {
        return cloudFailure("交換する個数を確認してください。");
      }

      const { data, error } = await settle(() =>
        supabase.rpc("exchange_food", {
          p_kind: kind,
          p_amount: amount,
          p_request_id: clientRequestId,
          p_expected_user_id: operationUserId,
        }),
      );

      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }

      if (error) {
        const failure = foodFailure(error, "exchange");
        if (failure.shouldRefresh) {
          await refreshCloudData();
        }
        return cloudFailure(failure.message);
      }

      const result = itemInventoryResultSchema.safeParse(data);
      if (!result.success) {
        return cloudFailure("交換結果を確認できませんでした。ページを再読み込みしてください。");
      }

      if (!result.data.created) {
        const latest = await refreshCloudData();
        return latest
          ? { ok: true, data: latest.maso }
          : cloudFailure("交換は完了していますが、最新の所持数を確認できませんでした。もう一度読み込んでください。");
      }

      const nextMaso = {
        ...cloudState.maso,
        growthPoints: result.data.growthPoints,
        food: result.data.food,
        protein: result.data.protein,
        items: result.data.items,
      };
      setCloudState((current) => ({ ...current, maso: nextMaso }));
      setCloudIssue(null);
      return { ok: true, data: nextMaso };
    },
    [
      authState.userId,
      cloudReady,
      cloudState.maso,
      local,
      refreshCloudData,
      supabase,
      usingLocal,
    ],
  );

  const feedMaso = useCallback(
    async (
      kind: FoodKind,
      amount: number,
      clientRequestId: string,
    ): Promise<ActionResult<MasoStatus>> => {
      if (usingLocal) {
        return local.feedMaso(kind, amount);
      }

      if (!supabase || !authState.userId || !cloudReady) {
        return cloudFailure("クラウドへの接続を確認しています。少し待ってからお試しください。");
      }
      const operationUserId = authState.userId;

      if (
        !isValidItemActionAmount(amount) ||
        !z.string().uuid().safeParse(clientRequestId).success
      ) {
        return cloudFailure("あげる個数を確認してください。");
      }

      const { data, error } = await settle(() =>
        supabase.rpc("feed_maso_item", {
          p_kind: kind,
          p_amount: amount,
          p_request_id: clientRequestId,
          p_expected_user_id: operationUserId,
        }),
      );

      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }

      if (error) {
        const failure = foodFailure(error, "feed");
        if (failure.shouldRefresh) {
          await refreshCloudData();
        }
        return cloudFailure(failure.message);
      }

      const result = feedMasoItemResultSchema.safeParse(data);
      if (!result.success) {
        return cloudFailure("エサやりの結果を確認できませんでした。ページを再読み込みしてください。");
      }

      if (!result.data.created) {
        const latest = await refreshCloudData();
        return latest
          ? { ok: true, data: latest.maso }
          : cloudFailure("エサやりは完了していますが、最新の状態を確認できませんでした。もう一度読み込んでください。");
      }

      const nextMaso = {
        ...cloudState.maso,
        level: result.data.level,
        experience: result.data.experience,
        food: result.data.food,
        protein: result.data.protein,
        items: result.data.items,
      };
      setCloudState((current) => ({ ...current, maso: nextMaso }));
      setCloudIssue(null);
      return { ok: true, data: nextMaso };
    },
    [
      authState.userId,
      cloudReady,
      cloudState.maso,
      local,
      refreshCloudData,
      supabase,
      usingLocal,
    ],
  );

  const renameMaso = useCallback(
    async (name: string): Promise<ActionResult<MasoStatus>> => {
      if (usingLocal) {
        return local.renameMaso(name);
      }

      if (!supabase || !authState.userId || !cloudReady) {
        return cloudFailure("クラウドへの接続を確認しています。少し待ってからお試しください。");
      }
      const operationUserId = authState.userId;

      const parsed = displayNameFieldSchema("名前").safeParse(name);
      if (!parsed.success) {
        return cloudFailure(parsed.error.issues[0]?.message ?? "名前を確認してください。");
      }

      const { data, error } = await settle(() =>
        supabase.rpc("rename_maso", {
          p_name: parsed.data,
          p_expected_user_id: operationUserId,
        }),
      );
      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }
      if (error) {
        return cloudFailure(describeRpcError(error, "名前"));
      }

      const result = renameMasoResultSchema.safeParse(data);
      if (!result.success) {
        // 保存自体は成功している可能性が高い。最新の状態を取り直して確認する。
        const latest = await refreshCloudData();
        return latest
          ? { ok: true, data: latest.maso }
          : cloudFailure("保存した名前を確認できませんでした。ページを再読み込みしてください。");
      }

      const savedName = result.data.name;
      // 直前の操作で変わった育成値などを上書きしないよう、名前だけを差し替える
      setCloudState((current) => ({
        ...current,
        maso: { ...current.maso, name: savedName },
      }));
      setCloudIssue(null);
      return { ok: true, data: { ...cloudState.maso, name: savedName } };
    },
    [
      authState.userId,
      cloudReady,
      cloudState.maso,
      local,
      refreshCloudData,
      supabase,
      usingLocal,
    ],
  );

  const clearLocalData = useCallback(async (): Promise<ActionResult<null>> => {
    if (!usingLocal) {
      return cloudFailure("クラウド上の記録は、この操作では削除されません。");
    }

    return local.clearLocalData();
  }, [local, usingLocal]);

  const updateProfile = useCallback(
    async (displayName: string): Promise<ActionResult<AppProfile>> => {
      if (!usingCloud) {
        return cloudFailure("プロフィールは、アカウントへログインすると保存できます。");
      }

      if (!supabase || !authState.userId || !cloudReady) {
        return cloudFailure("クラウドへの接続を確認しています。少し待ってからお試しください。");
      }
      const operationUserId = authState.userId;

      const parsed = displayNameFieldSchema("表示名").safeParse(displayName);
      if (!parsed.success) {
        return cloudFailure(parsed.error.issues[0]?.message ?? "表示名を確認してください。");
      }

      // 表示名の正規化と検証はサーバー側で行うため、専用のRPC経由で保存する
      const { data, error } = await settle(() =>
        supabase.rpc("update_display_name", { p_name: parsed.data }),
      );
      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }
      if (error) {
        return cloudFailure(describeRpcError(error, "表示名"));
      }

      const result = updateDisplayNameResultSchema.safeParse(data);
      if (!result.success) {
        const latest = await refreshCloudData();
        return latest
          ? { ok: true, data: latest.profile }
          : cloudFailure("保存した表示名を確認できませんでした。ページを再読み込みしてください。");
      }

      const profile = { displayName: result.data.displayName };
      setCloudState((current) => ({ ...current, profile }));
      setCloudIssue(null);
      return { ok: true, data: profile };
    },
    [authState.userId, cloudReady, refreshCloudData, supabase, usingCloud],
  );

  const value = useMemo<AppDataContextValue>(
    () => ({
      version: activeState.version,
      profile:
        usingCloud && cloudReady
          ? cloudState.profile
          : {
              displayName:
                storageMode === "local" ? "ローカルユーザー" : "トレーニー",
            },
      records: activeState.records,
      exercises: activeState.exercises,
      bodyWeights: activeState.bodyWeights,
      settings: activeState.settings,
      maso: activeState.maso,
      isReady,
      storageIssue:
        storageMode === "loading"
          ? null
          : storageMode === "signed-out"
            ? "ログインの有効期限が切れました。もう一度ログインしてください。"
          : usingCloud
            ? cloudIssueUserId === authState.userId
              ? cloudIssue
              : null
            : local.storageIssue,
      storageMode,
      retryStorage,
      addWorkout,
      updateWorkout,
      deleteWorkout,
      addExercise,
      saveBodyWeight,
      updateSettings,
      exchangeGrowthPoints,
      feedMaso,
      renameMaso,
      clearLocalData,
      updateProfile,
    }),
    [
      activeState.bodyWeights,
      activeState.exercises,
      activeState.maso,
      activeState.records,
      activeState.settings,
      activeState.version,
      addExercise,
      addWorkout,
      updateWorkout,
      deleteWorkout,
      saveBodyWeight,
      clearLocalData,
      cloudReady,
      cloudIssue,
      cloudIssueUserId,
      cloudState.profile,
      exchangeGrowthPoints,
      feedMaso,
      isReady,
      local.storageIssue,
      authState.userId,
      renameMaso,
      retryStorage,
      storageMode,
      updateProfile,
      updateSettings,
      usingCloud,
    ],
  );

  return (
    <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
  );
}

export function useAppData(): AppDataContextValue {
  const context = useContext(AppDataContext);

  if (!context) {
    throw new Error("useAppData must be used within AppDataProvider");
  }

  return context;
}
