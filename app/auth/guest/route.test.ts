import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/auth/guest/route";
import { hasVerifiedSession } from "@/lib/auth/server";

vi.mock("@/lib/auth/server", () => ({ hasVerifiedSession: vi.fn() }));
const origin = "https://fitness.example.test";

function guestRequest(next: string, requestOrigin = origin) {
  return new NextRequest(`${origin}/auth/guest`, {
    method: "POST",
    headers: { origin: requestOrigin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ next }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(hasVerifiedSession).mockResolvedValue(false);
});

describe("guest admission", () => {
  it("admits a guest using a lasting local preference and a 303 redirect", async () => {
    const response = await POST(guestRequest("/records?date=2026-10-11"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/records?date=2026-10-11`);
    expect(response.cookies.get("musclememo-guest")).toMatchObject({ value: "1", path: "/", maxAge: 31_536_000, sameSite: "lax" });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("blocks outside-origin guest selection", async () => {
    const response = await POST(guestRequest("/", "https://outside.example"));
    expect(response.status).toBe(403);
    expect(response.cookies.getAll()).toHaveLength(0);
    expect(hasVerifiedSession).not.toHaveBeenCalled();
  });

  it("admits a browser-facing loopback origin when Next normalizes its URL to localhost", async () => {
    const request = new NextRequest("http://localhost:3181/auth/guest", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3181", host: "127.0.0.1:3181", "Content-Type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" },
      body: new URLSearchParams({ next: "/" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3181/");
    expect(response.cookies.get("musclememo-guest")?.value).toBe("1");
  });

  it("rejects a different port even when the hostname matches", async () => {
    const request = guestRequest("/", "https://fitness.example.test:444");
    request.headers.set("host", "fitness.example.test");
    expect((await POST(request)).status).toBe(403);
  });

  it("admits the public HTTPS origin behind a TLS-terminating proxy", async () => {
    const request = new NextRequest("http://fitness.example.test/auth/guest", {
      method: "POST",
      headers: { origin, host: "fitness.example.test", "x-forwarded-proto": "https", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ next: "/" }),
    });
    expect((await POST(request)).status).toBe(303);
  });

  it("ignores a redirect to another origin", async () => {
    const response = await POST(guestRequest("//outside.example/"));
    expect(response.headers.get("location")).toBe(`${origin}/`);
  });

  it("does not replace an authenticated cloud account with local guest data", async () => {
    vi.mocked(hasVerifiedSession).mockResolvedValue(true);
    const response = await POST(guestRequest("/"));
    expect(response.cookies.get("musclememo-guest")).toMatchObject({ value: "", maxAge: 0 });
  });
});
