import { z } from "zod";

import {
  isNameAllowed,
  NAME_NOT_ALLOWED_MESSAGE,
} from "@/lib/domain/name-filter";

/**
 * ユーザーが付ける名前（アカウントの表示名・マソ君の名前）の正規化と検証。
 *
 * `trim()` だけでは、ゼロ幅スペースやハングル埋め字(U+3164)、点字空白(U+2800)などの
 * 「見えない文字」だけの名前が通ってしまい、表示が空白になる。保存前に見えない文字を
 * 取り除き、空白を1つにまとめ、見える文字が残らない名前は拒否する。
 *
 * DB側は supabase/migrations/0004_display_name_normalization.sql の
 * `normalize_display_name()` が同じ規則を実装している。両者の一致は
 * display-name.test.ts と supabase/tests/account-isolation.mjs で確認している。
 */
export const NAME_MAX_LENGTH = 30;
export const DEFAULT_DISPLAY_NAME = "トレーニー";
export const DEFAULT_MASO_NAME = "マソ君";

/** 取り除く見えない文字・制御文字。SQL側の正規表現と同じ集合にすること。 */
export const INVISIBLE_CHARACTERS =
  "\\u0000-\\u0008\\u000e-\\u001f\\u007f-\\u009f\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5" +
  "\\u180b-\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\u2800\\u3164" +
  "\\ufeff\\uffa0\\ufff9-\\ufffb";

/** 1つの半角スペースにまとめる空白類。 */
export const WHITESPACE_CHARACTERS =
  " \\t\\n\\r\\f\\v\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

const INVISIBLE_PATTERN = new RegExp(`[${INVISIBLE_CHARACTERS}]`, "g");
const WHITESPACE_PATTERN = new RegExp(`[${WHITESPACE_CHARACTERS}]+`, "g");
const VISIBLE_PATTERN = /[\p{L}\p{N}\p{S}\p{P}]/u;

export type DisplayNameProblem =
  | "empty"
  | "invisible"
  | "too-long"
  | "not-allowed";

export const DISPLAY_NAME_MESSAGES: Record<DisplayNameProblem, string> = {
  empty: "名前を入力してください。",
  invisible: "文字が見えない名前は使えません。文字・数字・記号を入れてください。",
  "too-long": `名前は${NAME_MAX_LENGTH}文字以内で入力してください。`,
  "not-allowed": NAME_NOT_ALLOWED_MESSAGE,
};

/** 見えない文字を除き、空白を1つにまとめて前後を削る。 */
export function normalizeDisplayName(input: string): string {
  return input
    .normalize("NFC")
    .replace(INVISIBLE_PATTERN, "")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
}

export function displayNameLength(name: string): number {
  return Array.from(name).length;
}

export type DisplayNameResult =
  | { ok: true; name: string }
  | { ok: false; problem: DisplayNameProblem; message: string };

/**
 * @param options.filter 禁止ワードも判定する(既定)。保存済みの値を表示する場合など、
 *   形式だけを見たいときは false にする。
 */
export function validateDisplayName(
  input: string,
  options: { filter?: boolean } = {},
): DisplayNameResult {
  const name = normalizeDisplayName(input);
  let problem: DisplayNameProblem | null = null;

  if (name === "") {
    // 入力そのものが空か、見えない文字だけだったかで案内を変える
    problem = input.trim() === "" ? "empty" : "invisible";
  } else if (!VISIBLE_PATTERN.test(name)) {
    problem = "invisible";
  } else if (displayNameLength(name) > NAME_MAX_LENGTH) {
    problem = "too-long";
  } else if (options.filter !== false && !isNameAllowed(name)) {
    problem = "not-allowed";
  }

  return problem === null
    ? { ok: true, name }
    : { ok: false, problem, message: DISPLAY_NAME_MESSAGES[problem] };
}

/**
 * 保存済みの値を表示に使うとき用。見える文字がなければ既定の名前を返し、
 * 画面が空白になったり、読み込み全体が失敗したりしないようにする。
 */
export function displayNameOrDefault(
  stored: string | null | undefined,
  fallback: string,
): string {
  const result = validateDisplayName(stored ?? "", { filter: false });
  if (result.ok) {
    return result.name;
  }

  if (result.problem === "too-long") {
    return Array.from(normalizeDisplayName(stored ?? ""))
      .slice(0, NAME_MAX_LENGTH)
      .join("");
  }

  return fallback;
}

/**
 * 入力欄から受け取った名前用のZodスキーマ。正規化した名前を返す。
 * @param label 文言に使う呼び名（「名前」「表示名」など）
 */
export function displayNameFieldSchema(label = "名前") {
  return z.string().transform((value, context) => {
    const result = validateDisplayName(value);

    if (!result.ok) {
      const message =
        result.problem === "empty"
          ? `${label}を入力してください。`
          : result.problem === "too-long"
            ? `${label}は${NAME_MAX_LENGTH}文字以内で入力してください。`
            : result.message;
      context.addIssue({ code: "custom", message });
      return z.NEVER;
    }

    return result.name;
  });
}

export const displayNameSchema = displayNameFieldSchema("名前");

/** 保存済みの値を読み込むZodスキーマ。不正でも失敗させず既定の名前にする。 */
export function storedNameSchema(fallback: string) {
  return z.string().transform((value) => displayNameOrDefault(value, fallback));
}
