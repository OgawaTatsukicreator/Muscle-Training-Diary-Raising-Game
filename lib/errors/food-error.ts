import { describeRpcError } from "@/lib/errors/rpc-error";

export type FoodFailure = {
  message: string;
  /** 画面の所持数・ポイントが古い可能性がある。最新の状態を取り直すとよい */
  shouldRefresh: boolean;
};

function messageOf(error: unknown): string {
  return error && typeof error === "object"
    ? (((error as { message?: string | null }).message) ?? "")
    : "";
}

/**
 * アイテムの交換・エサやりで返るエラーを、利用者向けの文言にする。
 * 「足りない」系は、別の端末やタブで先に使っていた場合に起きる。
 * 画面の数字が古いので、取り直して表示を直せるよう shouldRefresh を返す。
 */
export function foodFailure(
  error: unknown,
  action: "exchange" | "feed",
): FoodFailure {
  const text = messageOf(error);

  if (/insufficient growth points/i.test(text)) {
    return {
      message: "育成ポイントが足りません。最新の所持ポイントを読み込みました。",
      shouldRefresh: true,
    };
  }

  if (/insufficient food/i.test(text)) {
    return {
      message: "エサが足りません。最新の所持数を読み込みました。",
      shouldRefresh: true,
    };
  }

  if (/inventory limit reached/i.test(text)) {
    return {
      message: "これ以上アイテムを所持できません。",
      shouldRefresh: false,
    };
  }

  if (/idempotency key reused/i.test(text)) {
    return {
      message:
        "前回の操作と内容が食い違っています。ページを再読み込みして、もう一度お試しください。",
      shouldRefresh: true,
    };
  }

  return {
    message: describeRpcError(
      error,
      action === "exchange" ? "アイテムの交換" : "エサやり",
    ),
    shouldRefresh: false,
  };
}
