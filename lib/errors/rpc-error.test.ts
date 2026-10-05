import { describe, expect, it } from "vitest";

import {
  classifyRpcError,
  describeRpcError,
  isRetryableRpcError,
  rpcErrorMessage,
  settle,
  type RpcErrorKind,
} from "@/lib/errors/rpc-error";

describe("classifyRpcError", () => {
  it.each<[string, unknown, RpcErrorKind]>([
    ["name filter rejection", { code: "22023", message: "name not allowed" }, "name-not-allowed"],
    ["invalid input", { code: "22023", message: "invalid name" }, "validation"],
    ["check violation", { code: "23514", message: "violates check" }, "validation"],
    ["not logged in", { code: "28000", message: "authentication required" }, "auth"],
    ["expired JWT", { code: "PGRST303", message: "JWT expired" }, "auth"],
    ["401 status", { status: 401, message: "Unauthorized" }, "auth"],
    ["account mismatch", { code: "42501", message: "authentication context changed" }, "forbidden"],
    ["403 status", { status: 403 }, "forbidden"],
    ["missing row", { code: "P0002", message: "exercise not found" }, "not-found"],
    ["single row not found", { code: "PGRST116", message: "no rows" }, "not-found"],
    ["duplicate", { code: "23505", message: "duplicate key" }, "conflict"],
    ["serialization failure", { code: "40001" }, "conflict"],
    ["deadlock", { code: "40P01" }, "conflict"],
    ["rate limit", { status: 429 }, "rate-limit"],
    ["function not deployed", { code: "PGRST202", message: "Could not find the function" }, "unavailable"],
    ["server error", { status: 503, message: "Service Unavailable" }, "server"],
    ["fetch failure message", { message: "TypeError: Failed to fetch" }, "network"],
    ["fetch exception", new TypeError("Failed to fetch"), "network"],
    ["status zero", { status: 0 }, "network"],
    ["anything else", { code: "XYZ", message: "mystery" }, "unknown"],
    ["null", null, "unknown"],
    ["string", "boom", "unknown"],
  ])("%s", (_name, error, expected) => {
    expect(classifyRpcError(error)).toBe(expected);
  });

  it("checks the name filter before the generic validation code", () => {
    expect(classifyRpcError({ code: "22023", message: "name not allowed" })).toBe(
      "name-not-allowed",
    );
  });
});

describe("rpcErrorMessage", () => {
  it("gives every kind a distinct, actionable message", () => {
    const kinds: RpcErrorKind[] = [
      "network", "auth", "forbidden", "validation", "name-not-allowed", "not-found",
      "conflict", "rate-limit", "unavailable", "server", "unknown",
    ];
    const messages = kinds.map((kind) => rpcErrorMessage(kind, "記録"));

    expect(new Set(messages).size).toBe(kinds.length);
    expect(messages.every((message) => message.length > 0)).toBe(true);
  });

  it("puts the subject into messages that need it", () => {
    expect(rpcErrorMessage("validation", "名前")).toContain("名前");
    expect(rpcErrorMessage("not-found", "記録")).toContain("記録");
    expect(rpcErrorMessage("unknown", "体重")).toContain("体重");
  });

  it("describes a raw error in one call", () => {
    expect(describeRpcError({ message: "Failed to fetch" }, "名前")).toContain("通信");
  });
});

describe("isRetryableRpcError", () => {
  it("retries only transient failures", () => {
    for (const kind of ["network", "conflict", "rate-limit", "server"] as RpcErrorKind[]) {
      expect(isRetryableRpcError(kind)).toBe(true);
    }
    for (const kind of ["auth", "validation", "name-not-allowed", "forbidden", "not-found"] as RpcErrorKind[]) {
      expect(isRetryableRpcError(kind)).toBe(false);
    }
  });
});

describe("settle", () => {
  it("passes a normal result through", async () => {
    await expect(settle(async () => ({ data: 1, error: null }))).resolves.toEqual({
      data: 1,
      error: null,
    });
  });

  it("turns a thrown fetch failure into an error value", async () => {
    const result = await settle(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(result.data).toBeNull();
    expect(classifyRpcError(result.error)).toBe("network");
  });
});
