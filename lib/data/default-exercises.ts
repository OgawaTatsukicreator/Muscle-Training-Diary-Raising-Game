import { EXERCISE_MASTER } from "@/lib/data/exercise-master";
import type { Exercise } from "@/lib/domain/workout";

export const DEFAULT_EXERCISES: Exercise[] = EXERCISE_MASTER.map((item) => ({
  id: item.key,
  name: item.name,
  bodyPart: item.bodyPart,
  isDefault: true,
  calculationPattern: item.calculationPattern,
  bwRatio: item.bwRatio,
  isIsometric: item.isIsometric,
}));
