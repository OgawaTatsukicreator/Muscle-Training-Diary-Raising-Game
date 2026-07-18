export const GROWTH_POINT_VOLUME_STEP_KG = 100;
export const FOOD_VOLUME_STEP_KG = 500;
export const EXPERIENCE_PER_FOOD = 10;
export const MAX_MASO_LEVEL = 999;

export function rewardsFromVolume(volumeKg: number): {
  growthPoints: number;
  food: number;
} {
  if (!Number.isFinite(volumeKg) || volumeKg <= 0) {
    return { growthPoints: 0, food: 0 };
  }

  return {
    growthPoints: Math.floor(volumeKg / GROWTH_POINT_VOLUME_STEP_KG),
    food: Math.floor(volumeKg / FOOD_VOLUME_STEP_KG),
  };
}

export function requiredExperienceForLevel(level: number): number {
  return Math.max(1, Math.floor(level)) * 100;
}

export function applyExperience(
  currentLevel: number,
  currentExperience: number,
  gainedExperience: number,
): { level: number; experience: number; levelsGained: number } {
  let level = Math.min(MAX_MASO_LEVEL, Math.max(1, Math.floor(currentLevel)));
  let experience = Math.max(0, Math.floor(currentExperience));
  const remaining = Math.max(0, Math.floor(gainedExperience));
  const startingLevel = level;

  experience += remaining;

  while (
    level < MAX_MASO_LEVEL &&
    experience >= requiredExperienceForLevel(level)
  ) {
    experience -= requiredExperienceForLevel(level);
    level += 1;
  }

  if (level === MAX_MASO_LEVEL) {
    experience = Math.min(experience, requiredExperienceForLevel(MAX_MASO_LEVEL));
  }

  return { level, experience, levelsGained: level - startingLevel };
}
