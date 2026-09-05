export function registrationErrorMessage(error: { code?: string; status?: number }): string {
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return "登録のリクエストが集中しています。少し時間をおいてから、もう一度お試しください。";
  }
  if (error.code === "weak_password") {
    return "このパスワードは使用できません。英字・数字・記号を組み合わせた、別のパスワードを入力してください。";
  }
  if (error.code === "signup_disabled" || error.code === "email_provider_disabled") {
    return "現在、新規登録を受け付けていません。アプリの管理者にお問い合わせください。";
  }
  if (error.code === "email_address_not_authorized") {
    return "確認メールを送信できません。アプリの管理者にメール送信設定の確認を依頼してください。";
  }
  // Do not reveal whether an email address already has an account.
  return "アカウントを作成できませんでした。時間をおいて再度お試しください。登録済みの方はログインしてください。";
}
