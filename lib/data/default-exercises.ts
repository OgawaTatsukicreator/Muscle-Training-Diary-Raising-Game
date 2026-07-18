import type { Exercise } from "@/lib/domain/workout";

export const DEFAULT_EXERCISES: Exercise[] = [
  { id: "default-bench-press", name: "ベンチプレス", bodyPart: "chest", isDefault: true },
  { id: "default-push-up", name: "プッシュアップ", bodyPart: "chest", isDefault: true },
  { id: "default-lat-pulldown", name: "ラットプルダウン", bodyPart: "back", isDefault: true },
  { id: "default-deadlift", name: "デッドリフト", bodyPart: "back", isDefault: true },
  { id: "default-squat", name: "スクワット", bodyPart: "legs", isDefault: true },
  { id: "default-leg-press", name: "レッグプレス", bodyPart: "legs", isDefault: true },
  { id: "default-shoulder-press", name: "ショルダープレス", bodyPart: "shoulders", isDefault: true },
  { id: "default-side-raise", name: "サイドレイズ", bodyPart: "shoulders", isDefault: true },
  { id: "default-arm-curl", name: "アームカール", bodyPart: "arms", isDefault: true },
  { id: "default-triceps-extension", name: "トライセプスエクステンション", bodyPart: "arms", isDefault: true },
  { id: "default-crunch", name: "クランチ", bodyPart: "abs", isDefault: true },
  { id: "default-plank", name: "プランク", bodyPart: "abs", isDefault: true },
  { id: "default-walking", name: "ウォーキング", bodyPart: "cardio", isDefault: true },
  { id: "default-running", name: "ランニング", bodyPart: "cardio", isDefault: true },
];
