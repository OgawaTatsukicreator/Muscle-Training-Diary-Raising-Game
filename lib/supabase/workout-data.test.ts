import { describe, expect, it } from "vitest";
import { DEFAULT_EXERCISES } from "@/lib/data/default-exercises";
import { applyWorkoutChange, createAsyncQueue, decodeWorkoutRow, fetchWorkoutChange } from "@/lib/supabase/workout-data";
import type { createClient } from "@/lib/supabase/client";

const exercise = { ...DEFAULT_EXERCISES[0], id: "11111111-1111-4111-8111-111111111111" };
const id = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const row = {
  id, client_request_id: "44444444-4444-4444-8444-444444444444", workout_date: "2026-10-11",
  exercise_id: exercise.id, weight_kg: "60", reps: 10, sets: 3, volume_kg: "1800",
  body_weight_kg: null, assist_kg: "0", load_per_unit_kg: "60", memo: "canonical DB memo",
  created_at: "2026-10-11T13:00:00+00:00",
};

function database(workout: unknown = row, failTable?: string) {
  const reads: { table: string; filters: [string, unknown][]; limitOne: boolean }[] = [];
  const from = (table: string) => {
    const read = { table, filters: [] as [string, unknown][], limitOne: false };
    reads.push(read);
    const result = { data: table === "workout_logs" ? workout : table === "maso_status" ? { growth_points: 1836 } : { log_date: "2026-10-11", weight_kg: "72" }, error: table === failTable ? new Error("Network failed") : null };
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { read.filters.push([column, value]); return query; },
      is: (column: string, value: unknown) => { read.filters.push([column, value]); return query; },
      single: () => { read.limitOne = true; return Promise.resolve(result); },
      maybeSingle: () => { read.limitOne = true; return Promise.resolve(result); },
    };
    return query;
  };
  return { client: { from } as unknown as NonNullable<ReturnType<typeof createClient>>, reads };
}

describe("cloud workout changes", () => {
  it("serializes canonical reads and continues after a failed read", async () => {
    const queue = createAsyncQueue();
    const starts: number[] = [];
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const first = queue(async () => { starts.push(1); await hold; throw new Error("offline"); });
    const second = queue(async () => { starts.push(2); return "latest balance"; });
    const failed = expect(first).rejects.toThrow("offline");
    await Promise.resolve();
    expect(starts).toEqual([1]);
    release();
    await failed;
    expect(await second).toBe("latest balance");
    expect(starts).toEqual([1, 2]);
  });
  it("reads only the changed row and canonical balance, scoped to the user", async () => {
    const db = database();
    const change = await fetchWorkoutChange(db.client, userId, id, [exercise]);
    expect(change.record?.memo).toBe("canonical DB memo");
    expect(change.growthPoints).toBe(1836);
    expect(db.reads.map((read) => read.table)).toEqual(["workout_logs", "maso_status"]);
    expect(db.reads.every((read) => read.limitOne && read.filters.some(([key, value]) => key === "user_id" && value === userId))).toBe(true);
    expect(db.reads[0].filters).toContainEqual(["id", id]);
    expect(db.reads[0].filters).toContainEqual(["deleted_at", null]);
  });
  it("reads only the explicitly changed body-weight date", async () => {
    const db = database();
    const change = await fetchWorkoutChange(db.client, userId, id, [exercise], "2026-10-11");
    expect(db.reads).toHaveLength(3);
    expect(db.reads[2].filters).toContainEqual(["log_date", "2026-10-11"]);
    expect(change.bodyWeight).toEqual({ date: "2026-10-11", weightKg: 72 });
  });
  it.each(["workout_logs", "maso_status", "body_weight_logs"])("does not apply an incomplete %s response", async (table) => {
    const db = database(row, table);
    await expect(fetchWorkoutChange(db.client, userId, id, [exercise], "2026-10-11")).rejects.toThrow();
  });
  it("accepts numeric strings and UTC offsets, but rejects malformed rows", () => {
    const record = decodeWorkoutRow(row, [exercise]);
    expect(record.weightKg).toBe(60);
    expect(record.createdAt).toBe("2026-10-11T13:00:00.000Z");
    expect(() => decodeWorkoutRow({ ...row, volume_kg: "bad" }, [exercise])).toThrow();
    expect(() => decodeWorkoutRow(row, [])).toThrow();
  });
  it("merges without replacing unrelated records, inventory or profile, even for 10,000 records", async () => {
    const db = database();
    const change = await fetchWorkoutChange(db.client, userId, id, [exercise]);
    const record = change.record!;
    const priorRecords = Array.from({ length: 10_000 }, (_, index) => ({ ...record, id: `existing-${index}` }));
    const state = { records: priorRecords, bodyWeights: [], maso: { growthPoints: 0, food: 10 }, profile: { displayName: "A" } };
    const saved = applyWorkoutChange(state, id, change);
    expect(saved.records).toHaveLength(10_001);
    expect(saved.records[0]).toBe(priorRecords[0]);
    expect(saved.maso).toEqual({ growthPoints: 1836, food: 10 });
    expect(saved.profile).toBe(state.profile);
    expect(applyWorkoutChange(saved, id, change).records).toHaveLength(10_001);
    const removed = applyWorkoutChange(saved, id, { ...change, record: null });
    expect(removed.records).toHaveLength(10_000);
    expect(removed.records.some((item) => item.id === id)).toBe(false);
    expect(db.reads).toHaveLength(2);
  });
});
