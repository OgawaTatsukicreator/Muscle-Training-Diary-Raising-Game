import type { Metadata } from "next";

import { WorkoutEditScreen } from "@/components/workout/workout-edit-screen";

export const metadata: Metadata = {
  title: "記録の編集",
};

export default async function EditWorkoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <WorkoutEditScreen workoutId={id} />;
}
