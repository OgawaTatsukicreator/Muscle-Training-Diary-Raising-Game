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
import { isValidItemActionAmount, type FoodKind } from "@/lib/domain/growth";
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
  },
};

const profileRowSchema = z.object({
  display_name: z.string().trim().min(1).max(30),
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
  maso_name: z.string().trim().min(1).max(30),
  level: z.number().int().min(1).max(999),
  experience: z.number().int().min(0).max(99_900),
  growth_points: z.number().int().min(0),
});

const foodRowSchema = z.object({
  balance: z.number().int().min(0),
  protein_balance: z.number().int().min(0),
});

const saveWorkoutResultSchema = z.object({
  id: z.string().uuid(),
  volumeKg: z.coerce.number().finite().min(0),
  loadPerUnitKg: z.coerce.number().finite().min(0),
  bodyWeightKg: nullableNumericSchema.optional(),
  growthPoints: z.number().int().min(0),
  food: z.number().int().min(0),
  created: z.boolean(),
});

const renameMasoResultSchema = z.object({
  name: z.string().trim().min(1).max(30),
});

const itemInventoryResultSchema = z.object({
  growthPoints: z.number().int().min(0),
  food: z.number().int().min(0),
  protein: z.number().int().min(0),
  created: z.boolean(),
});

const feedMasoItemResultSchema = z.object({
  level: z.number().int().min(1).max(999),
  experience: z.number().int().min(0).max(99_900),
  food: z.number().int().min(0),
  protein: z.number().int().min(0),
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

function missingRpc(error: { code?: string; message?: string } | null): boolean {
  return (
    error?.code === "PGRST202" ||
    Boolean(error?.message?.includes("Could not find the function"))
  );
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
    ]);

  const firstError = [
    profileResult.error,
    settingsResult.error,
    masoResult.error,
    foodResult.error,
    bodyWeightResult.error,
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

      const { data, error } = await supabase.rpc("save_workout", {
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
      });

      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }

      if (error) {
        return cloudFailure("記録をクラウドへ保存できませんでした。入力内容と通信状態を確認してください。");
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
      const { data, error } = await supabase.rpc("add_exercise", {
        p_name: normalizedName,
        p_body_part: bodyPart,
        p_uses_bodyweight: options?.usesBodyweight === true,
        p_is_isometric: options?.isIsometric === true,
      });

      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }

      if (error) {
        return cloudFailure("種目を追加できませんでした。同じ種目がないか確認してください。");
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

      const { data, error } = await supabase.rpc("save_body_weight", {
        p_log_date: parsed.data.date,
        p_weight_kg: parsed.data.weightKg,
      });

      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }

      if (error) {
        return cloudFailure("体重をクラウドへ保存できませんでした。もう一度お試しください。");
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

      const { data, error } = await supabase.rpc("exchange_food", {
        p_kind: kind,
        p_amount: amount,
        p_request_id: clientRequestId,
        p_expected_user_id: authState.userId,
      });

      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }

      if (error) {
        return cloudFailure(
          missingRpc(error)
            ? "クラウド版のアイテム交換は、データベース更新後に利用できます。"
            : "アイテムを交換できませんでした。残高と通信状態を確認してください。",
        );
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

      const { data, error } = await supabase.rpc("feed_maso_item", {
        p_kind: kind,
        p_amount: amount,
        p_request_id: clientRequestId,
        p_expected_user_id: authState.userId,
      });

      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }

      if (error) {
        return cloudFailure(
          missingRpc(error)
            ? "クラウド版のエサやりは、データベース更新後に利用できます。"
            : "エサをあげられませんでした。所持数と通信状態を確認してください。",
        );
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

      const parsed = z.string().trim().min(1).max(30).safeParse(name);
      if (!parsed.success) {
        return cloudFailure("名前は1〜30文字で入力してください。");
      }

      const { data, error } = await supabase.rpc("rename_maso", {
        p_name: parsed.data,
        p_expected_user_id: authState.userId,
      });
      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }
      if (error) {
        return cloudFailure("名前を保存できませんでした。もう一度お試しください。");
      }

      const result = renameMasoResultSchema.safeParse(data);
      if (!result.success) {
        return cloudFailure("保存した名前を確認できませんでした。ページを再読み込みしてください。");
      }

      const nextMaso = { ...cloudState.maso, name: result.data.name };
      setCloudState((current) => ({ ...current, maso: nextMaso }));
      setCloudIssue(null);
      return { ok: true, data: nextMaso };
    },
    [
      authState.userId,
      cloudReady,
      cloudState.maso,
      local,
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

      const parsed = z.string().trim().min(1).max(30).safeParse(displayName);
      if (!parsed.success) {
        return cloudFailure("表示名は1〜30文字で入力してください。");
      }

      const { data, error } = await supabase
        .from("profiles")
        .update({ display_name: parsed.data })
        .eq("id", authState.userId)
        .select("display_name")
        .single();
      if (activeUserIdRef.current !== operationUserId) {
        return cloudFailure("ログイン中のアカウントが変わりました。ページを再読み込みしてください。");
      }
      if (error) {
        return cloudFailure("プロフィールを保存できませんでした。もう一度お試しください。");
      }

      const row = profileRowSchema.safeParse(data);
      if (!row.success) {
        return cloudFailure("保存したプロフィールを確認できませんでした。ページを再読み込みしてください。");
      }

      const profile = { displayName: row.data.display_name };
      setCloudState((current) => ({ ...current, profile }));
      setCloudIssue(null);
      return { ok: true, data: profile };
    },
    [authState.userId, cloudReady, supabase, usingCloud],
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
