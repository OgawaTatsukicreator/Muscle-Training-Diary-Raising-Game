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
