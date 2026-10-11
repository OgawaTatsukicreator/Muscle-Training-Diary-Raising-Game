import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { requestOrigin } from "@/lib/auth/request-origin";

describe("browser-facing request origin", () => {
  it("retains the loopback host and port instead of Next's internal localhost", () => {
    expect(requestOrigin(new NextRequest("http://localhost:3181/", { headers: { host: "127.0.0.1:3181" } }))).toBe("http://127.0.0.1:3181");
  });

  it("retains the public HTTPS origin behind TLS termination", () => {
    expect(requestOrigin(new NextRequest("http://localhost:3000/", { headers: { host: "masodiary.vercel.app", "x-forwarded-proto": "https" } }))).toBe("https://masodiary.vercel.app");
  });

  it("does not turn malformed Host text into a redirect target", () => {
    expect(requestOrigin(new NextRequest("https://fitness.example.test/", { headers: { host: "fitness.example.test@outside.example" } }))).toBe("https://fitness.example.test");
  });
});
