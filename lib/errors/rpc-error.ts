/**
 * Supabase(PostgREST)の呼び出しで返るエラーを分類し、利用者向けの文言にする。
 *
 * 以前は失敗をすべて「もう一度お試しください」にしていたため、入力の不備と
 * 通信断・ログイン切れの区別がつかず、利用者が次に何をすればよいか分からなかった。
 * DB関数が返すエラーコード(supabase/migrations)とここの分類は対応させる:
 *   28000 未ログイン / 42501 権限・アカウント不一致 / 22023 入力不正 / P0002 対象なし
 *   23505 重複 / 40001・40P01 競合 / 'name not allowed' は使用できない名前
 */
export type RpcErrorKind =
  | "network"
  | "auth"
  | "forbidden"
  | "validation"
  | "name-not-allowed"
  | "not-found"
  | "conflict"
  | "rate-limit"
  | "unavailable"
  | "server"
  | "unknown";

export type RpcErrorLike = {
  code?: string | null;
  message?: string | null;
  status?: number | null;
  details?: string | null;
  hint?: string | null;
};

function toErrorLike(error: unknown): RpcErrorLike {
  if (error instanceof TypeError) {
    // fetch が通信できなかったときの例外
    return { message: error.message, code: "FETCH_FAILED" };
  }

  if (error && typeof error === "object") {
    return error as RpcErrorLike;
  }

  return { message: typeof error === "string" ? error : null };
}

export function classifyRpcError(error: unknown): RpcErrorKind {
  const { code, message, status } = toErrorLike(error);
  const text = message ?? "";

  if (/name not allowed/i.test(text)) {
    return "name-not-allowed";
  }

  if (
    code === "FETCH_FAILED" ||
    status === 0 ||
    /failed to fetch|fetch failed|networkerror|network request failed|load failed|timeout|timed out|econn|enotfound|offline/i.test(
      text,
    )
  ) {
    return "network";
  }

  if (
    code === "28000" ||
    code === "PGRST301" ||
    code === "PGRST303" ||
    status === 401 ||
    /jwt|not authenticated|authentication required/i.test(text)
  ) {
    return "auth";
  }

  if (code === "PGRST202" || /could not find the function/i.test(text)) {
    return "unavailable";
  }

  if (code === "42501" || status === 403) {
    return "forbidden";
  }

  if (status === 429) {
    return "rate-limit";
  }

  if (
    code === "22023" ||
    code === "22003" ||
    code === "22P02" ||
    code === "23514" ||
    code === "23502" ||
    code === "23503" ||
    (status === 400 && code !== "PGRST116")
  ) {
    return "validation";
  }

  if (code === "P0002" || code === "PGRST116" || status === 404) {
    return "not-found";
  }

  if (code === "23505" || code === "40001" || code === "40P01" || status === 409) {
    return "conflict";
  }

  if (
    (typeof status === "number" && status >= 500) ||
    (typeof code === "string" && /^(XX|53|57|58)/.test(code))
  ) {
    return "server";
  }

  return "unknown";
}

/** 同じ操作をもう一度試せば成功し得るエラーか。 */
export function isRetryableRpcError(kind: RpcErrorKind): boolean {
  return (
    kind === "network" ||
    kind === "conflict" ||
    kind === "rate-limit" ||
    kind === "server"
  );
}

/**
 * @param subject 操作の主語。「名前」「記録」など。文言に差し込む。
 */
export function rpcErrorMessage(kind: RpcErrorKind, subject: string): string {
  switch (kind) {
    case "network":
      return "通信できませんでした。インターネット接続を確認して、もう一度お試しください。";
    case "auth":
      return "ログインの有効期限が切れました。もう一度ログインしてください。";
    case "forbidden":
      return "この操作は許可されていません。ページを再読み込みして、もう一度お試しください。";
    case "validation":
      return `${subject}の入力内容を確認してください。`;
    case "name-not-allowed":
      return "この名前は使用できません。別の名前にしてください。";
    case "not-found":
      return `${subject}が見つかりませんでした。ページを再読み込みして、最新の状態を確認してください。`;
    case "conflict":
      return "ほかの操作と重なりました。少し待ってから、もう一度お試しください。";
    case "rate-limit":
      return "操作が集中しています。少し時間をおいてから、もう一度お試しください。";
    case "unavailable":
      return "サーバー側の更新がまだ反映されていないため、この操作はできません。管理者にお問い合わせください。";
    case "server":
      return "サーバーで問題が発生しました。時間をおいて、もう一度お試しください。";
    default:
      return `${subject}を保存できませんでした。もう一度お試しください。`;
  }
}

export function describeRpcError(error: unknown, subject: string): string {
  return rpcErrorMessage(classifyRpcError(error), subject);
}

/**
 * Supabaseの呼び出しを実行し、例外も `error` として返す。通信断で
 * fetch が例外を投げても、画面側が「保存中」のまま固まらないようにする。
 */
export async function settle<T>(
  call: () => PromiseLike<{ data: T | null; error: unknown }>,
): Promise<{ data: T | null; error: unknown }> {
  try {
    return await call();
  } catch (error) {
    return { data: null, error: error ?? new Error("unknown error") };
  }
}
