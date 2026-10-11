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

import type { BodyWeightEntry } from "@/lib/domain/body-weight";
import type { FoodKind } from "@/lib/domain/growth";
import type { CustomExerciseOptions } from "@/lib/domain/load";
import type {
  BodyPart,
  Exercise,
  UserSettings,
  WorkoutDraft,
  WorkoutRecord,
} from "@/lib/domain/workout";
import {
  addGuestExercise,
  addGuestWorkout,
  deleteGuestWorkout,
  exchangeGuestGrowthPoints,
  feedGuestMaso,
  renameGuestMaso,
  saveGuestBodyWeight,
  updateGuestSettings,
  updateGuestWorkout,
} from "@/lib/storage/guest-actions";
import {
  GUEST_STORAGE_KEY,
  initialGuestState,
  type ActionResult,
  type DemoDataState,
  type GuestMutation,
  type MasoStatus,
} from "@/lib/storage/guest-state";
import {
  createBrowserGuestStore,
  guestStorageMessage,
  type TransactionalGuestStore,
} from "@/lib/storage/transactional-guest-store";

export type {
  ActionResult,
  DemoDataState,
  MasoStatus,
} from "@/lib/storage/guest-state";

export type DemoDataContextValue = DemoDataState & {
  isReady: boolean;
  storageIssue: string | null;
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
  updateSettings: (settings: UserSettings) => Promise<ActionResult<UserSettings>>;
  exchangeGrowthPoints: (
    kind: FoodKind,
    amount?: number,
  ) => Promise<ActionResult<MasoStatus>>;
  feedMaso: (kind: FoodKind, amount?: number) => Promise<ActionResult<MasoStatus>>;
  renameMaso: (name: string) => Promise<ActionResult<MasoStatus>>;
  clearLocalData: () => Promise<ActionResult<null>>;
};

const DemoDataContext = createContext<DemoDataContextValue | null>(null);

export function DemoDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoDataState>(initialGuestState);
  const [isReady, setIsReady] = useState(false);
  const [storageIssue, setStorageIssue] = useState<string | null>(null);
  const storeRef = useRef<TransactionalGuestStore | null>(null);

  useEffect(() => {
    const store = createBrowserGuestStore();
    storeRef.current = store;
    const synchronize = () => {
      try {
        setState(store.read());
        setStorageIssue(null);
      } catch (error) {
        setStorageIssue(guestStorageMessage(error));
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === GUEST_STORAGE_KEY || event.key === null) synchronize();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") synchronize();
    };
    // Hydrate from external storage without rewriting the entire state on mount.
    synchronize();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsReady(true);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", synchronize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      storeRef.current = null;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", synchronize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const change = useCallback(
    async <T,>(reduce: (latest: DemoDataState) => GuestMutation<T>): Promise<ActionResult<T>> => {
      const store = storeRef.current;
      if (!store) {
        return { ok: false, message: "端末のデータを読み込み中です。少し待ってからお試しください。" };
      }
      try {
        const mutation = await store.change(reduce);
        // Another tab may have committed before this promise resumed. Show the newest data.
        let latest = mutation.state;
        try {
          latest = store.read();
        } catch {
          // The committed result is still valid.
        }
        setState(latest);
        setStorageIssue(null);
        return mutation.result;
      } catch (error) {
        const message = guestStorageMessage(error);
        setStorageIssue(message);
        return { ok: false, message };
      }
    },
    [],
  );

  const addWorkout = useCallback(
    (draft: WorkoutDraft, clientRequestId: string) =>
      change((latest) => addGuestWorkout(latest, draft, clientRequestId)),
    [change],
  );
  const updateWorkout = useCallback(
    (workoutId: string, draft: WorkoutDraft, clientRequestId: string) => {
      void clientRequestId;
      return change((latest) => updateGuestWorkout(latest, workoutId, draft));
    },
    [change],
  );
  const deleteWorkout = useCallback(
    (workoutId: string, clientRequestId: string) => {
      void clientRequestId;
      return change((latest) => deleteGuestWorkout(latest, workoutId));
    },
    [change],
  );
  const addExercise = useCallback(
    (name: string, bodyPart: BodyPart, options?: CustomExerciseOptions) =>
      change((latest) => addGuestExercise(latest, name, bodyPart, options)),
    [change],
  );
  const saveBodyWeight = useCallback(
    (date: string, weightKg: number) =>
      change((latest) => saveGuestBodyWeight(latest, date, weightKg)),
    [change],
  );
  const updateSettings = useCallback(
    (settings: UserSettings) => change((latest) => updateGuestSettings(latest, settings)),
    [change],
  );
  const exchangeGrowthPoints = useCallback(
    (kind: FoodKind, amount = 1) =>
      change((latest) => exchangeGuestGrowthPoints(latest, kind, amount)),
    [change],
  );
  const feedMaso = useCallback(
    (kind: FoodKind, amount = 1) => change((latest) => feedGuestMaso(latest, kind, amount)),
    [change],
  );
  const renameMaso = useCallback(
    (name: string) => change((latest) => renameGuestMaso(latest, name)),
    [change],
  );
  const clearLocalData = useCallback(async (): Promise<ActionResult<null>> => {
    const store = storeRef.current;
    if (!store) {
      return { ok: false, message: "端末のデータを読み込み中です。少し待ってからお試しください。" };
    }
    try {
      const cleared = await store.clear();
      let latest = cleared;
      try {
        latest = store.read();
      } catch {
        // Clearing succeeded; preserve the result.
      }
      setState(latest);
      setStorageIssue(null);
      return { ok: true, data: null };
    } catch (error) {
      const message = guestStorageMessage(error);
      setStorageIssue(message);
      return { ok: false, message };
    }
  }, []);

  const value = useMemo<DemoDataContextValue>(
    () => ({
      ...state,
      isReady,
      storageIssue,
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
    }),
    [state, isReady, storageIssue, addWorkout, updateWorkout, deleteWorkout,
      addExercise, saveBodyWeight, updateSettings, exchangeGrowthPoints, feedMaso,
      renameMaso, clearLocalData],
  );

  return <DemoDataContext.Provider value={value}>{children}</DemoDataContext.Provider>;
}

export function useDemoData(): DemoDataContextValue {
  const context = useContext(DemoDataContext);
  if (!context) throw new Error("useDemoData must be used within DemoDataProvider");
  return context;
}
