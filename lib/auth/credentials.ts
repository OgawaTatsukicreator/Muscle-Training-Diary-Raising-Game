import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .min(1, "メールアドレスを入力してください。")
  .max(254, "メールアドレスは254文字以内で入力してください。")
  .email("メールアドレスの形式を確認してください。");

export const loginCredentialsSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, "パスワードを入力してください。"),
  })
  .strict();

export const registrationCredentialsSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, "表示名を入力してください。")
      .max(30, "表示名は30文字以内で入力してください。"),
    email: emailSchema,
    password: z
      .string()
      .min(8, "パスワードは8文字以上で入力してください。")
      .max(72, "パスワードは72文字以内で入力してください。"),
    passwordConfirmation: z.string(),
  })
  .strict()
  .superRefine((credentials, context) => {
    if (credentials.password !== credentials.passwordConfirmation) {
      context.addIssue({
        code: "custom",
        path: ["passwordConfirmation"],
        message: "確認用パスワードが一致しません。",
      });
    }
  });

export type LoginCredentials = z.infer<typeof loginCredentialsSchema>;
export type RegistrationCredentials = z.infer<
  typeof registrationCredentialsSchema
>;

