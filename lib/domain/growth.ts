export const GROWTH_POINT_VOLUME_STEP_KG = 100;
export const EXPERIENCE_PER_FOOD = 10;
export const MAX_MASO_LEVEL = 999;
export const MAX_MASO_PHASE = 50;
export const MAX_ITEM_ACTION_AMOUNT = 1_000;

/**
 * エサの種類。価格と経験値は supabase/migrations/0007_more_food_items.sql の
 * food_item_stats() と同じ値にすること（単体テストで一致を確認している）。
 * 並びは安い順で、画面の表示順にもなる。
 */
export const FOOD_ITEMS = {
  banana: {
    name: "バナナ",
    growthPointCost: 2,
    experience: 4,
  },
  onigiri: {
    name: "おにぎり",
    growthPointCost: 5,
    experience: 10,
  },
  chicken: {
    name: "ささみ",
    growthPointCost: 10,
    experience: 21,
  },
  protein: {
    name: "プロテイン",
    growthPointCost: 15,
    experience: 30,
  },
  steak: {
    name: "ステーキ",
    growthPointCost: 40,
    experience: 90,
  },
} as const;

export type FoodKind = keyof typeof FOOD_ITEMS;
export const FOOD_KINDS = Object.keys(FOOD_ITEMS) as FoodKind[];

/**
 * 在庫の持ち方。おにぎり・プロテインは従来の列(food / protein)、
 * バナナ・ささみ・ステーキは items に入れる(DBの保存方法に合わせている)。
 */
export const EXTRA_FOOD_KINDS = ["banana", "chicken", "steak"] as const;
export type ExtraFoodKind = (typeof EXTRA_FOOD_KINDS)[number];
export type FoodItems = Record<ExtraFoodKind, number>;
export const EMPTY_FOOD_ITEMS: FoodItems = { banana: 0, chicken: 0, steak: 0 };

export type FoodInventory = {
  food: number;
  protein: number;
  items: FoodItems;
};

function isExtraFoodKind(kind: FoodKind): kind is ExtraFoodKind {
  return (EXTRA_FOOD_KINDS as readonly string[]).includes(kind);
}

export function foodBalance(inventory: FoodInventory, kind: FoodKind): number {
  if (kind === "onigiri") return inventory.food;
  if (kind === "protein") return inventory.protein;
  return isExtraFoodKind(kind) ? (inventory.items[kind] ?? 0) : 0;
}

/** 指定した種類の在庫だけを差し替えた新しい在庫を返す。 */
export function withFoodBalance<T extends FoodInventory>(
  inventory: T,
  kind: FoodKind,
  balance: number,
): T {
  if (kind === "onigiri") return { ...inventory, food: balance };
  if (kind === "protein") return { ...inventory, protein: balance };

  return { ...inventory, items: { ...inventory.items, [kind]: balance } };
}

export function totalFoodCount(inventory: FoodInventory): number {
  return FOOD_KINDS.reduce((sum, kind) => sum + foodBalance(inventory, kind), 0);
}

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

/**
 * 記録の編集・削除で育成ポイントを調整する。DBの update_workout / delete_workout と同じ規則。
 *
 * - その記録に「実際に付与済み」のポイント(granted)を、新しいボリューム相当の値へ合わせる
 *   (削除なら 0)。差分が正なら加算、負なら減算する。
 * - すでに使ったポイントは取り戻せない。所持ポイントが0を下回らない範囲までしか減らさず、
 *   実際に減らした分だけ granted を更新する。
 * - 次回の調整は、計算式ではなく granted から始める。これにより、減らす→増やすを
 *   繰り返してもポイントを水増しできない。
 */
export function workoutRewardAdjustment(input: {
  /** この記録に付与済みのポイント */
  granted: number;
  /** 編集後のボリューム(kg)。削除は 0 */
  volumeKg: number;
  /** 現在の所持ポイント */
  balance: number;
}): { applied: number; granted: number; target: number } {
  const target = rewardsFromVolume(input.volumeKg).growthPoints;
  // `|| 0` で -0 を 0 にそろえる
  const applied =
    Math.max(target - input.granted, -Math.max(0, input.balance)) || 0;

  return { applied, granted: input.granted + applied, target };
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
