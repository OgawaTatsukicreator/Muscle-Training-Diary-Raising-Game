import { describe, expect, it, vi } from "vitest";

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
  MAX_LOCAL_BODY_WEIGHTS,
  MAX_LOCAL_RECORDS,
  parseGuestState,
  type DemoDataState,
} from "@/lib/storage/guest-state";
import {
  GuestStorageError,
  TransactionalGuestStore,
  type GuestLockRunner,
} from "@/lib/storage/transactional-guest-store";
import { workoutDraftSchema, type WorkoutDraft, type WorkoutRecord } from "@/lib/domain/workout";

function seed(count = 0): DemoDataState {
  let state = initialGuestState();
  if (count > 0) {
    const first = addGuestWorkout(state, draft(), "seed-first");
    if (!first.result.ok) throw new Error(first.result.message);
    const record = first.result.data;
    state = {
      ...state,
      records: Array.from({ length: count }, (_, index) => ({
        ...record, id: `seed-${index}`, clientRequestId: `seed-request-${index}`,
      })),
      maso: { ...state.maso, growthPoints: count * 18 },
    };
  }
  return state;
}

function draft(overrides: Partial<WorkoutDraft> = {}): WorkoutDraft {
  const exercise = initialGuestState().exercises.find((item) => item.id === "default-bench-press");
  if (!exercise) throw new Error("bench press fixture missing");
  return workoutDraftSchema.parse({
    workoutDate: "2026-01-02", exerciseId: exercise.id, bodyPart: exercise.bodyPart,
    weight: 60, unit: "kg", reps: 10, sets: 3, memo: "", ...overrides,
  });
}

function setup(state = seed()) {
  const values = new Map<string, string>([[GUEST_STORAGE_KEY, JSON.stringify(state)]]);
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  // Different store instances represent stale tabs. Both must use the same origin lock.
  const queues = new Map<string, Promise<unknown>>();
  const lock: GuestLockRunner = (name, operation) => {
    const next = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(operation);
    queues.set(name, next);
    return next;
  };
  const tabA = new TransactionalGuestStore(() => storage, lock);
  const tabB = new TransactionalGuestStore(() => storage, lock);
  tabA.read();
  tabB.read();
  return { values, storage, tabA, tabB, lock };
}

function savedRecord(result: Awaited<ReturnType<TransactionalGuestStore["change"]>>): WorkoutRecord {
  if (!result.result.ok) throw new Error(result.result.message);
  return result.result.data as WorkoutRecord;
}

describe("guest storage transactions", () => {
  it("preserves both concurrent saves and both rewards from stale tabs (performance regression)", async () => {
    const { tabA, tabB } = setup(seed(100));
    const [a, b] = await Promise.all([
      tabA.change((state) => addGuestWorkout(state, draft({ memo: "parallel-A" }), "request-A")),
      tabB.change((state) => addGuestWorkout(state, draft({ memo: "parallel-B" }), "request-B")),
    ]);
    expect(a.result.ok && b.result.ok).toBe(true);
    const latest = tabA.read();
    expect(latest.records).toHaveLength(102);
    expect(latest.maso.growthPoints).toBe(1836);
    expect(latest.records.map((record) => record.memo)).toEqual(expect.arrayContaining(["parallel-A", "parallel-B"]));
    expect(tabB.read()).toEqual(latest);
  });

  it("does not grant rewards twice when tabs resend the same request", async () => {
    const { tabA, tabB, storage } = setup();
    const [a, b] = await Promise.all([
      tabA.change((state) => addGuestWorkout(state, draft(), "same-request")),
      tabB.change((state) => addGuestWorkout(state, draft(), "same-request")),
    ]);
    expect(savedRecord(a).id).toBe(savedRecord(b).id);
    expect(tabA.read().records).toHaveLength(1);
    expect(tabA.read().maso.growthPoints).toBe(18);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("checks the record cap inside the lock, allowing only one of two final saves", async () => {
    const { tabA, tabB } = setup(seed(MAX_LOCAL_RECORDS - 1));
    const results = await Promise.all([
      tabA.change((state) => addGuestWorkout(state, draft(), "last-A")),
      tabB.change((state) => addGuestWorkout(state, draft(), "last-B")),
    ]);
    expect(results.filter(({ result }) => result.ok)).toHaveLength(1);
    expect(tabA.read().records).toHaveLength(MAX_LOCAL_RECORDS);
    expect(tabA.read().maso.growthPoints).toBe(MAX_LOCAL_RECORDS * 18);
  });

  it("uses the current balance for simultaneous exchanges and prevents overspending", async () => {
    const state = seed();
    state.maso.growthPoints = 2;
    const { tabA, tabB } = setup(state);
    const results = await Promise.all([
      tabA.change((latest) => exchangeGuestGrowthPoints(latest, "banana", 1)),
      tabB.change((latest) => exchangeGuestGrowthPoints(latest, "banana", 1)),
    ]);
    expect(results.filter(({ result }) => result.ok)).toHaveLength(1);
    expect(tabA.read().maso.growthPoints).toBe(0);
    expect(tabA.read().maso.items.banana).toBe(1);
  });

  it("uses the current inventory for simultaneous feed operations", async () => {
    const state = seed();
    state.maso.items.banana = 1;
    const { tabA, tabB } = setup(state);
    const results = await Promise.all([
      tabA.change((latest) => feedGuestMaso(latest, "banana", 1)),
      tabB.change((latest) => feedGuestMaso(latest, "banana", 1)),
    ]);
    expect(results.filter(({ result }) => result.ok)).toHaveLength(1);
    expect(tabA.read().maso.items.banana).toBe(0);
    expect(tabA.read().maso.experience).toBe(4);
  });

  it("keeps another tab's reward while renaming", async () => {
    const { tabA, tabB } = setup(seed(1));
    await Promise.all([
      tabA.change((latest) => addGuestWorkout(latest, draft(), "new-record")),
      tabB.change((latest) => renameGuestMaso(latest, "マソちゃん")),
    ]);
    expect(tabA.read().records).toHaveLength(2);
    expect(tabA.read().maso).toMatchObject({ growthPoints: 36, name: "マソちゃん" });
  });

  it("does not resurrect a record edited after another tab deleted it", async () => {
    const { tabA, tabB } = setup(seed(1));
    await tabA.change((state) => deleteGuestWorkout(state, "seed-0"));
    const edited = await tabB.change((state) => updateGuestWorkout(state, "seed-0", draft({ weight: 80 })));
    expect(edited.result.ok).toBe(false);
    expect(tabB.read().records).toHaveLength(0);
    expect(tabB.read().maso.growthPoints).toBe(0);
  });

  it("does not double subtract rewards when tabs delete the same record", async () => {
    const { tabA, tabB } = setup(seed(2));
    const results = await Promise.all([
      tabA.change((state) => deleteGuestWorkout(state, "seed-0")),
      tabB.change((state) => deleteGuestWorkout(state, "seed-0")),
    ]);
    expect(results.map(({ result }) => result.ok && result.data.growthPointsDelta)).toEqual([-18, 0]);
    expect(tabA.read().maso.growthPoints).toBe(18);
  });

  it("deduplicates concurrent custom exercise additions", async () => {
    const { tabA, tabB } = setup();
    await Promise.all([
      tabA.change((state) => addGuestExercise(state, "カスタム プレス", "chest")),
      tabB.change((state) => addGuestExercise(state, "カスタム  プレス", "chest")),
    ]);
    expect(tabA.read().exercises.filter((exercise) => !exercise.isDefault)).toHaveLength(1);
  });

  it("returns failure on quota errors without publishing or caching an unsaved change, and permits retry", async () => {
    const { tabA, tabB, storage, values } = setup(seed(100));
    const before = values.get(GUEST_STORAGE_KEY);
    storage.setItem.mockImplementationOnce(() => { throw new DOMException("quota", "QuotaExceededError"); });
    await expect(tabA.change((state) => addGuestWorkout(state, draft(), "quota-request"))).rejects.toMatchObject({ kind: "write" });
    expect(values.get(GUEST_STORAGE_KEY)).toBe(before);
    expect(tabA.read().records).toHaveLength(100);
    expect(tabB.read().maso.growthPoints).toBe(1800);
    const retried = await tabA.change((state) => addGuestWorkout(state, draft(), "quota-request"));
    expect(retried.result.ok).toBe(true);
    expect(tabA.read().records).toHaveLength(101);
  });

  it("does not overwrite corrupt data on read or change, but allows explicit clearing", async () => {
    const { tabA, storage, values } = setup();
    values.set(GUEST_STORAGE_KEY, "{invalid");
    expect(() => tabA.read()).toThrow(GuestStorageError);
    await expect(tabA.change((state) => addGuestWorkout(state, draft(), "request"))).rejects.toMatchObject({ kind: "invalid" });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(values.get(GUEST_STORAGE_KEY)).toBe("{invalid");
    expect((await tabA.clear()).records).toHaveLength(0);
    expect(values.has(GUEST_STORAGE_KEY)).toBe(false);
  });

  it("fails safely when reading storage is denied", async () => {
    const { tabA, storage } = setup();
    storage.getItem.mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    await expect(tabA.change((state) => addGuestWorkout(state, draft(), "request"))).rejects.toMatchObject({ kind: "read" });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("keeps old data readable and refuses unsafe writes when Web Locks are unavailable", async () => {
    const { storage } = setup(seed(100));
    const oldBrowser = new TransactionalGuestStore(() => storage, null);
    expect(oldBrowser.read().records).toHaveLength(100);
    await expect(oldBrowser.change((state) => addGuestWorkout(state, draft(), "request"))).rejects.toMatchObject({ kind: "unsupported" });
    await expect(oldBrowser.clear()).rejects.toMatchObject({ kind: "unsupported" });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("does not write on hydration, cross-tab reads, unchanged settings, or duplicate requests", async () => {
    const { tabA, tabB, storage } = setup(seed(1));
    tabA.read();
    tabB.read();
    await tabA.change((state) => updateGuestSettings(state, state.settings));
    await tabB.change((state) => addGuestWorkout(state, draft(), "seed-request-0"));
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("clears under the same lock, so a queued save sees empty data rather than resurrecting old records", async () => {
    const { tabA, tabB } = setup(seed(100));
    await Promise.all([
      tabA.clear(),
      tabB.change((state) => addGuestWorkout(state, draft(), "after-clear")),
    ]);
    expect(tabA.read().records).toHaveLength(1);
    expect(tabA.read().records[0].clientRequestId).toBe("after-clear");
    expect(tabA.read().maso.growthPoints).toBe(18);
  });

  it("observes another tab's saved settings and clear without writing the snapshot back", async () => {
    const { tabA, tabB, storage } = setup(seed(1));
    await tabA.change((state) => updateGuestSettings(state, { defaultSets: 5, weightUnit: "lb" }));
    expect(tabB.read().settings).toEqual({ defaultSets: 5, weightUnit: "lb" });
    await tabA.clear();
    expect(tabB.read().records).toHaveLength(0);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
});

describe("guest state compatibility and boundaries", () => {
  it("reads the version 1 format before bodyweight, load and new inventory fields existed", () => {
    const legacy = seed(1) as unknown as Record<string, unknown>;
    delete legacy.bodyWeights;
    const maso = legacy.maso as Record<string, unknown>;
    delete maso.protein;
    delete maso.items;
    const record = (legacy.records as Record<string, unknown>[])[0];
    for (const key of ["bodyWeightKg", "assistKg", "loadPerUnitKg", "rewardPoints"]) delete record[key];
    const parsed = parseGuestState(JSON.stringify(legacy));
    expect(parsed.bodyWeights).toEqual([]);
    expect(parsed.maso.items).toEqual({ banana: 0, chicken: 0, steak: 0 });
    expect(parsed.records[0]).toMatchObject({ bodyWeightKg: null, assistKg: 0, loadPerUnitKg: null, rewardPoints: null });
  });

  it("enforces the bodyweight cap but still allows replacing a date at capacity", () => {
    const state = seed();
    state.bodyWeights = Array.from({ length: MAX_LOCAL_BODY_WEIGHTS }, (_, index) => ({
      date: new Date(Date.UTC(2000, 0, index + 1)).toISOString().slice(0, 10), weightKg: 70,
    }));
    expect(saveGuestBodyWeight(state, "2026-01-02", 71).result.ok).toBe(false);
    const replacement = saveGuestBodyWeight(state, state.bodyWeights[0].date, 72);
    expect(replacement.result.ok).toBe(true);
    expect(replacement.state.bodyWeights).toHaveLength(MAX_LOCAL_BODY_WEIGHTS);
    expect(addGuestWorkout(state, draft({ bodyWeightKg: 71 }), "bodyweight-cap").result.ok).toBe(false);
  });
});
