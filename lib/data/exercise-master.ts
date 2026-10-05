import type { CalculationPattern } from "@/lib/domain/load";
import type { BodyPart } from "@/lib/domain/workout";

export interface MasterExercise {
  /** 安定キー。既存の種目は従来の `default-*` ID を引き継ぐ(ローカル保存データの互換のため) */
  key: string;
  name: string;
  bodyPart: BodyPart;
  calculationPattern: CalculationPattern;
  bwRatio: number;
  isIsometric: boolean;
}

function ex(
  key: string,
  name: string,
  bodyPart: BodyPart,
  calculationPattern: CalculationPattern,
  bwRatio = 0,
  isIsometric = false,
): MasterExercise {
  return { key, name, bodyPart, calculationPattern, bwRatio, isIsometric };
}

/**
 * 種目マスター。係数はバイオメカニクス文献(Ebben 2011、ExRx.net等)に基づく目安で、
 * マソ君の成長ポイント算出にのみ使う。複数部位にまたがる種目は主働部位に分類している。
 */
export const EXERCISE_MASTER: readonly MasterExercise[] = [
  // A: 純・外部ウエイト
  ex("default-bench-press", "ベンチプレス", "chest", "A"),
  ex("incline-barbell-press", "インクライン・バーベルプレス", "chest", "A"),
  ex("chest-press-machine", "チェストプレス（マシン）", "chest", "A"),
  ex("pec-fly", "ペックフライ", "chest", "A"),
  ex("cable-crossover", "ケーブルクロスオーバー", "chest", "A"),
  ex("default-lat-pulldown", "ラットプルダウン", "back", "A"),
  ex("barbell-bent-over-row", "バーベル・ベントオーバーロウ", "back", "A"),
  ex("seated-row", "シーテッドロー", "back", "A"),
  ex("one-hand-dumbbell-row", "ワンハンド・ダンベルロウ", "back", "A"),
  ex("t-bar-row", "Tバーロウ", "back", "A"),
  ex("default-deadlift", "デッドリフト", "back", "A"),
  ex("default-shoulder-press", "バーベル・ショルダープレス", "shoulders", "A"),
  ex("dumbbell-shoulder-press", "ダンベル・ショルダープレス", "shoulders", "A"),
  ex("default-side-raise", "サイドレイズ", "shoulders", "A"),
  ex("rear-raise", "リアレイズ", "shoulders", "A"),
  ex("upright-row", "アップライトロウ", "shoulders", "A"),
  ex("default-arm-curl", "バーベルカール", "arms", "A"),
  ex("dumbbell-curl", "ダンベルカール", "arms", "A"),
  ex("triceps-pressdown", "トライセプス・プレスダウン", "arms", "A"),
  ex("skull-crusher", "スカルクラッシャー", "arms", "A"),
  ex("leg-extension", "レッグエクステンション", "legs", "A"),
  ex("leg-curl", "レッグカール", "legs", "A"),
  ex("seated-calf-raise", "シーテッド・カーフレイズ", "legs", "A"),

  // B: 下半身・移動型(自体重 + ウエイト)
  ex("default-squat", "バーベルスクワット", "legs", "B", 0.88),
  ex("front-squat", "フロントスクワット", "legs", "B", 0.88),
  ex("bodyweight-squat", "自重スクワット", "legs", "B", 0.88),
  ex("pistol-squat", "ピストルスクワット", "legs", "B", 0.88),
  ex("bulgarian-squat", "ブルガリアンスクワット", "legs", "B", 0.74),
  ex("walking-lunge", "ウォーキングランジ", "legs", "B", 0.74),
  ex("reverse-lunge", "リバースランジ", "legs", "B", 0.74),
  ex("step-up", "ステップアップ", "legs", "B", 0.74),
  ex("default-leg-press", "レッグプレス", "legs", "B", 0.7),
  ex("hack-squat", "ハックスクワット", "legs", "B", 0.88),
  ex("standing-calf-raise", "スタンディング・カーフレイズ", "legs", "B", 0.88),

  // C: 純・自体重型
  ex("default-push-up", "プッシュアップ", "chest", "C", 0.64),
  ex("knee-push-up", "膝付きプッシュアップ", "chest", "C", 0.49),
  ex("decline-push-up", "ディクライン・プッシュアップ", "chest", "C", 0.74),
  ex("incline-push-up", "インクライン・プッシュアップ", "chest", "C", 0.55),
  ex("pike-push-up", "パイクプッシュアップ", "shoulders", "C", 0.75),
  ex("handstand-push-up", "ハンドスタンド・プッシュアップ", "shoulders", "C", 0.9),
  ex("inverted-row", "インバーテッドロウ", "back", "C", 0.6),
  ex("hip-thrust", "ヒップスラスト", "legs", "C", 0.4),
  ex("back-extension", "バックエクステンション", "back", "C", 0.6),
  ex("good-morning", "グッドモーニング", "legs", "C", 0.6),
  ex("sit-up", "シットアップ", "abs", "C", 0.6),
  ex("default-crunch", "クランチ", "abs", "C", 0.4),
  ex("bicycle-crunch", "バイシクルクランチ", "abs", "C", 0.4),
  ex("leg-raise", "レッグレイズ", "abs", "C", 0.35),
  ex("v-sit", "Vシット", "abs", "C", 0.8),
  ex("default-plank", "プランク", "abs", "C", 0.65, true),
  ex("side-plank", "サイドプランク", "abs", "C", 0.5, true),
  ex("running-man", "ランニングマン", "abs", "C", 0.15),

  // D: ぶら下がり・支持(自重のほぼ全てを持ち上げる)
  ex("pull-up", "懸垂（プルアップ）", "back", "D", 0.9),
  ex("chin-up", "チンニング（逆手懸垂）", "back", "D", 0.9),
  ex("wide-grip-pull-up", "ワイドグリップ・プルアップ", "back", "D", 0.9),
  ex("muscle-up", "マッスルアップ", "back", "D", 0.9),
  ex("dips", "ディップス", "chest", "D", 0.91),
  ex("hanging-leg-raise", "ハンギング・レッグレイズ", "abs", "D", 0.35),

  // マスターに含まれない既存の標準種目(外部ウエイトとして扱う)
  ex("default-triceps-extension", "トライセプスエクステンション", "arms", "A"),
  ex("default-walking", "ウォーキング", "cardio", "A"),
  ex("default-running", "ランニング", "cardio", "A"),
];
