import type { Metadata } from "next";

import { WorkoutEntryForm } from "@/components/workout/workout-entry-form";
import { dateKeyInTimeZone, isDateKey } from "@/lib/domain/date";

export const metadata: Metadata = {
  title: "トレーニング記録",
};

export default async function NewWorkoutPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const rawDate = (await searchParams).date;
  const candidate = typeof rawDate === "string" ? rawDate : "";
  const today = dateKeyInTimeZone();
  const initialDate = isDateKey(candidate) && candidate <= today ? candidate : today;

  return <WorkoutEntryForm initialDate={initialDate} />;
}
