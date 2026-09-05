export const GROWTH_POINT_VOLUME_STEP_KG = 100;
export const EXPERIENCE_PER_FOOD = 10;
export const MAX_MASO_LEVEL = 999;
export const MAX_MASO_PHASE = 50;
export const MAX_ITEM_ACTION_AMOUNT = 1_000;

export const FOOD_ITEMS = {
  onigiri: {
    name: "おにぎり",
    growthPointCost: 5,
    experience: 10,
  },
  protein: {
    name: "プロテイン",
    growthPointCost: 15,
    experience: 30,
  },
} as const;

export type FoodKind = keyof typeof FOOD_ITEMS;

export function maxExchangeAmount(growthPoints: number, kind: FoodKind): number {
  if (!Number.isFinite(growthPoints) || growthPoints <= 0) {
    return 0;
  }

  return Math.min(
    MAX_ITEM_ACTION_AMOUNT,
    Math.floor(growthPoints / FOOD_ITEMS[kind].growthPointCost),
  );
}

export function clampItemActionAmount(amount: number, maximum: number): number {
  const safeMaximum = Number.isFinite(maximum)
    ? Math.max(1, Math.min(MAX_ITEM_ACTION_AMOUNT, Math.floor(maximum)))
    : 1;
  const safeAmount = Number.isFinite(amount) ? Math.floor(amount) : 1;
  return Math.max(1, Math.min(safeAmount, safeMaximum));
}

export function isValidItemActionAmount(amount: number): boolean {
  return (
    Number.isInteger(amount) && amount >= 1 && amount <= MAX_ITEM_ACTION_AMOUNT
  );
}

export function masoPhaseForLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 1;
  }

  return Math.min(MAX_MASO_PHASE, Math.max(1, Math.floor(level)));
}

export function masoImageForLevel(level: number): string {
  const phase = masoPhaseForLevel(level);
  return `/maso/phases-50/phase-${String(phase).padStart(2, "0")}.svg`;
}

export function rewardsFromVolume(volumeKg: number): {
  growthPoints: number;
} {
  if (!Number.isFinite(volumeKg) || volumeKg <= 0) {
    return { growthPoints: 0 };
  }

  return {
    growthPoints: Math.floor(volumeKg / GROWTH_POINT_VOLUME_STEP_KG),
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
