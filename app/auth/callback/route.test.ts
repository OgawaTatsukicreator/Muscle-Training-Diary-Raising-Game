import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/auth/callback/route";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const exchangeCodeForSession = vi.fn();
const origin = "https://fitness.example.test";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createClient).mockResolvedValue({ auth: { exchangeCodeForSession } } as unknown as NonNullable<Awaited<ReturnType<typeof createClient>>>);
  exchangeCodeForSession.mockResolvedValue({ data: { session: { access_token: "fake-test-token" } }, error: null });
});

describe("email-confirmation callback", () => {
  it("exchanges the confirmation code and switches from guest to account", async () => {
    const response = await GET(new NextRequest(`${origin}/auth/callback?code=test-code&next=%2Frecords`));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("test-code");
    expect(response.headers.get("location")).toBe(`${origin}/records`);
    expect(response.cookies.get("musclememo-guest")).toMatchObject({ value: "", path: "/", maxAge: 0 });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it.each(["missing-code", "auth-error", "network", "no-session"])("allows retry after %s without removing guest data preference", async (scenario) => {
    if (scenario === "auth-error") exchangeCodeForSession.mockResolvedValue({ data: {}, error: new Error("expired") });
    if (scenario === "network") exchangeCodeForSession.mockRejectedValue(new Error("network"));
    if (scenario === "no-session") exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
    const response = await GET(new NextRequest(`${origin}/auth/callback?next=%2Fanalytics${scenario === "missing-code" ? "" : "&code=test-code"}`));
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("status")).toBe("callback-error");
    expect(destination.searchParams.get("next")).toBe("/analytics");
    expect(response.cookies.get("musclememo-guest")).toBeUndefined();
  });

  it("keeps the post-confirmation destination inside the app", async () => {
    const response = await GET(new NextRequest(`${origin}/auth/callback?code=test-code&next=%2F%2Foutside.example`));
    expect(response.headers.get("location")).toBe(`${origin}/`);
  });

  it("keeps confirmation on the browser-facing host when Next normalizes localhost", async () => {
    const response = await GET(new NextRequest("http://localhost:3181/auth/callback?code=test-code", { headers: { host: "127.0.0.1:3181" } }));
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3181/");
  });
});
