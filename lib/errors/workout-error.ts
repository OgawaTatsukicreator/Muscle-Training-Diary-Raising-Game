import { classifyRpcError, describeRpcError } from "@/lib/errors/rpc-error";

export type WorkoutFailure = {
  message: string;
  fieldErrors?: Record<string, string>;
};

type ErrorLike = { message?: string | null };

function messageOf(error: unknown): string {
  return error && typeof error === "object"
    ? ((error as ErrorLike).message ?? "")
    : "";
}

/**
 * 記録の保存・編集・削除で返るエラーを、画面に出す文言と入力欄への指摘にする。
 * 画面の検証をすり抜けたサーバー側の拒否(体重の未入力、ボリューム過大など)も、
 * 汎用の「保存できません」ではなく、直す場所が分かる形で返す。
 */
export function workoutFailure(error: unknown): WorkoutFailure {
  const text = messageOf(error);

  if (/body weight required/i.test(text)) {
    return {
      message: "体重が必要な種目です。今日の体重を入力してください。",
      fieldErrors: { bodyWeightKg: "体重を入力してください" },
    };
  }

  if (/workout volume too large/i.test(text)) {
    return {
      message: "入力内容を確認してください。",
      fieldErrors: {
        volume:
          "1回の記録のボリュームが大きすぎます。重量・回数・セット数を確認してください",
      },
    };
  }

  if (/workout not found/i.test(text)) {
    return {
      message:
        "記録が見つかりませんでした。すでに削除された可能性があります。記録の一覧を開き直してください。",
    };
  }

  if (/idempotency key reused/i.test(text)) {
    return {
      message:
        "前回の保存操作と内容が食い違っています。ページを再読み込みして、もう一度お試しください。",
    };
  }

  if (classifyRpcError(error) === "validation") {
    return { message: "入力内容を確認してください。" };
  }

  return { message: describeRpcError(error, "記録") };
}
