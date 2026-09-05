import { describe, expect, it } from "vitest";

import { registrationErrorMessage } from "@/lib/auth/registration-error";

describe("registrationErrorMessage", () => {
  it.each([
    { status: 429 },
    { code: "over_email_send_rate_limit" },
    { code: "over_request_rate_limit" },
  ])("explains when registration must be retried later: %j", (error) => {
    expect(registrationErrorMessage(error)).toBe(
      "登録のリクエストが集中しています。少し時間をおいてから、もう一度お試しください。",
    );
  });

  it("explains how to recover from a rejected password", () => {
    expect(registrationErrorMessage({ code: "weak_password" })).toBe(
      "このパスワードは使用できません。英字・数字・記号を組み合わせた、別のパスワードを入力してください。",
    );
  });

  it.each(["signup_disabled", "email_provider_disabled"])(
    "explains that registration is unavailable for %s",
    (code) => {
      expect(registrationErrorMessage({ code })).toBe(
        "現在、新規登録を受け付けていません。アプリの管理者にお問い合わせください。",
      );
    },
  );

  it("directs email-delivery configuration failures to the administrator", () => {
    expect(registrationErrorMessage({ code: "email_address_not_authorized" })).toBe(
      "確認メールを送信できません。アプリの管理者にメール送信設定の確認を依頼してください。",
    );
  });

  it.each([{}, { code: "unexpected_failure", status: 500 }, { code: "user_already_exists" }, { code: "email_exists" }])(
    "gives a generic response without disclosing account existence: %j",
    (error) => {
      expect(registrationErrorMessage(error)).toBe(
        "アカウントを作成できませんでした。時間をおいて再度お試しください。登録済みの方はログインしてください。",
      );
    },
  );
});
