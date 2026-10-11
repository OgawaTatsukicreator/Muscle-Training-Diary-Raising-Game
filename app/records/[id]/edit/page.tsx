import type { Metadata } from "next";

import { WorkoutEditScreen } from "@/components/workout/workout-edit-screen";
import { parseRecordPage } from "@/lib/domain/record-pagination";

export const metadata: Metadata = {
  title: "記録の編集",
};

export default async function EditWorkoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnPage?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;

  return <WorkoutEditScreen workoutId={id} returnPage={parseRecordPage(query.returnPage)} />;
}
