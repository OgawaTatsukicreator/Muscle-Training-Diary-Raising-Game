import { z } from "zod";

import { isDateKey } from "@/lib/domain/date";
import { MAX_BODY_WEIGHT_KG, MIN_BODY_WEIGHT_KG } from "@/lib/domain/load";

export const bodyWeightEntrySchema = z
  .object({
    date: z.string().refine(isDateKey),
    weightKg: z.number().finite().min(MIN_BODY_WEIGHT_KG).max(MAX_BODY_WEIGHT_KG),
  })
  .strict();

export type BodyWeightEntry = z.infer<typeof bodyWeightEntrySchema>;

/** 指定日(含む)以前で最も新しい体重。無ければ null。 */
export function latestBodyWeightKg(
  entries: readonly BodyWeightEntry[],
  dateKey: string,
): number | null {
  let latest: BodyWeightEntry | null = null;

  for (const entry of entries) {
    if (entry.date <= dateKey && (latest === null || entry.date > latest.date)) {
      latest = entry;
    }
  }

  return latest?.weightKg ?? null;
}

/** 同じ日付の体重は上書きして、日付昇順に並べる。 */
export function upsertBodyWeight(
  entries: readonly BodyWeightEntry[],
  entry: BodyWeightEntry,
): BodyWeightEntry[] {
  return [...entries.filter((item) => item.date !== entry.date), entry].sort(
    (a, b) => a.date.localeCompare(b.date),
  );
}
