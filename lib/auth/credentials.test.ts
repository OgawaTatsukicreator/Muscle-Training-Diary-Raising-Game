import { describe, expect, it } from "vitest";

import {
  loginCredentialsSchema,
  registrationCredentialsSchema,
} from "@/lib/auth/credentials";

describe("loginCredentialsSchema", () => {
  it("normalizes an email address without changing the password", () => {
    expect(
      loginCredentialsSchema.parse({
        email: "  trainee@example.com  ",
        password: " pass phrase ",
      }),
    ).toEqual({
      email: "trainee@example.com",
      password: " pass phrase ",
    });
  });
});

describe("registrationCredentialsSchema", () => {
  const validCredentials = {
    displayName: "  トレーニー  ",
    email: "trainee@example.com",
    password: "strong-password",
    passwordConfirmation: "strong-password",
  };

  it("normalizes profile fields for a new account", () => {
    expect(registrationCredentialsSchema.parse(validCredentials)).toEqual({
      ...validCredentials,
      displayName: "トレーニー",
    });
  });

  it("removes invisible characters from the display name", () => {
    expect(
      registrationCredentialsSchema.parse({
        ...validCredentials,
        displayName: "ト\u200bレ\u3000ーニー",
      }).displayName,
    ).toBe("トレ ーニー");
  });

  it.each([
    ["", "表示名を入力してください。"],
    ["   ", "表示名を入力してください。"],
    ["\u3164", "文字が見えない名前は使えません。文字・数字・記号を入れてください。"],
    ["\u200b\u200b", "文字が見えない名前は使えません。文字・数字・記号を入れてください。"],
    ["あ".repeat(31), "表示名は30文字以内で入力してください。"],
  ])("rejects the unusable display name %j", (displayName, message) => {
    const result = registrationCredentialsSchema.safeParse({
      ...validCredentials,
      displayName,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["displayName"],
      message,
    });
  });

  it("rejects a mismatched confirmation password", () => {
    const result = registrationCredentialsSchema.safeParse({
      ...validCredentials,
      passwordConfirmation: "different-password",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["passwordConfirmation"],
      message: "確認用パスワードが一致しません。",
    });
  });

  it("requires a password that is at least eight characters", () => {
    const result = registrationCredentialsSchema.safeParse({
      ...validCredentials,
      password: "short",
      passwordConfirmation: "short",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["password"]);
  });
});
