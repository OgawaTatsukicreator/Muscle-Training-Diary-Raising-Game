import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updateSession } from "@/lib/supabase/proxy";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));

const APP_ORIGIN = "https://fitness.example.test";
const PUBLIC_URL = "https://fake-project.supabase.co";
const PUBLIC_KEY = "sb_publishable_fake_test_key";
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

type ClaimsResult = {
  data: { claims?: { sub: string } } | null;
  error: Error | null;
};

const getClaims = vi.fn<() => Promise<ClaimsResult>>();
const signedIn: ClaimsResult = { data: { claims: { sub: "test-account-a" } }, error: null };
let cookieMethods: CookieMethodsServer;

function requestFor(path: string, cookie?: string) {
  return new NextRequest(`${APP_ORIGIN}${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

function expectNoStore(response: Response) {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PUBLIC_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", PUBLIC_KEY);
  getClaims.mockResolvedValue({ data: null, error: null });
  vi.mocked(createServerClient).mockImplementation((_url, _key, options) => {
    cookieMethods = options.cookies as CookieMethodsServer;
    return { auth: { getClaims } } as unknown as ReturnType<typeof createServerClient>;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("updateSession", () => {
  it.each(["/", "/records?date=2026-09-06&view=week", "/records/entry-123", "/analytics", "/analytics/monthly"])(
    "sends a first-time guest from %s to welcome",
    async (path) => {
      const response = await updateSession(requestFor(path));
      const destination = new URL(response.headers.get("location")!);

      expect(response.status).toBe(307);
      expect(destination.origin).toBe(APP_ORIGIN);
      expect(destination.pathname).toBe("/welcome");
      expect(destination.searchParams.get("next")).toBe(path);
      expect(destination.searchParams.has("status")).toBe(false);
      expect(getClaims).toHaveBeenCalledOnce();
      expectNoStore(response);
    },
  );

  it.each(["sb-fake-project-auth-token", "sb-fake-project-auth-token.0", "sb-fake-project-auth-token.12"])(
    "sends an expired session using %s to login",
    async (cookieName) => {
      getClaims.mockResolvedValue({ data: null, error: new Error("Expired test session") });

      const response = await updateSession(requestFor("/records?date=2026-09-06", `${cookieName}=expired-test-token`));
      const destination = new URL(response.headers.get("location")!);

      expect(destination.pathname).toBe("/login");
      expect(destination.searchParams.get("status")).toBe("session-expired");
      expect(destination.searchParams.get("next")).toBe("/records?date=2026-09-06");
      expectNoStore(response);
    },
  );

  it.each(["theme=dark", "sb-fake-project-auth-token-code-verifier=test", "sb-fake-project-auth-token.other=test"])(
    "does not treat unrelated cookie %s as a previous session",
    async (cookie) => {
      const response = await updateSession(requestFor("/", cookie));
      const destination = new URL(response.headers.get("location")!);

      expect(destination.pathname).toBe("/welcome");
      expect(destination.searchParams.has("status")).toBe(false);
    },
  );

  it("rejects claims returned with an authentication error", async () => {
    getClaims.mockResolvedValue({ ...signedIn, error: new Error("Invalid test token") });

    const response = await updateSession(requestFor("/records"));

    expect(new URL(response.headers.get("location")!).pathname).toBe("/welcome");
  });

  it("rejects an empty claims response", async () => {
    getClaims.mockResolvedValue({ data: {}, error: null });

    const response = await updateSession(requestFor("/analytics"));

    expect(new URL(response.headers.get("location")!).pathname).toBe("/welcome");
  });

  it.each(["/", "/records", "/analytics"])("allows a verified account to access %s", async (path) => {
    getClaims.mockResolvedValue(signedIn);

    const response = await updateSession(requestFor(path));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(getClaims).toHaveBeenCalledOnce();
  });

  it.each(["/welcome", "/register?next=%2Frecords", "/login", "/auth/callback", "/records-old", "/records2", "/analytics-report", "/analytics2"])(
    "allows unauthenticated access to the public or similarly named route %s",
    async (path) => {
      const response = await updateSession(requestFor(path));

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("uses only the configured public credentials and passes request cookies to Supabase", async () => {
    await updateSession(requestFor("/welcome", "theme=dark; sb-fake-project-auth-token=test-token"));

    expect(createServerClient).toHaveBeenCalledWith(PUBLIC_URL, PUBLIC_KEY, expect.any(Object));
    expect(await cookieMethods.getAll()).toEqual([
      { name: "theme", value: "dark" },
      { name: "sb-fake-project-auth-token", value: "test-token" },
    ]);
  });

  it("propagates refreshed cookies to the next request and response with cache prevention", async () => {
    const request = requestFor("/records", "sb-fake-project-auth-token=old-test-token");
    const refreshedCookies = [
      { name: "sb-fake-project-auth-token.0", value: "new-test-part-0", options: { path: "/", httpOnly: true, secure: true, sameSite: "lax" as const } },
      { name: "sb-fake-project-auth-token.1", value: "new-test-part-1", options: { path: "/", httpOnly: true, secure: true, sameSite: "lax" as const } },
    ];
    getClaims.mockImplementationOnce(async () => {
      await cookieMethods.setAll?.(refreshedCookies, NO_STORE_HEADERS);
      return signedIn;
    });

    const response = await updateSession(request);

    expect(response.headers.get("location")).toBeNull();
    for (const { name, value, options } of refreshedCookies) {
      expect(request.cookies.get(name)?.value).toBe(value);
      expect(response.cookies.get(name)).toMatchObject({ name, value, ...options });
      expect(response.headers.get("x-middleware-request-cookie")).toContain(`${name}=${value}`);
    }
    expectNoStore(response);
  });

  it("keeps expired-session routing and cleared cookies after Supabase removes the incoming token", async () => {
    const request = requestFor("/analytics", "sb-fake-project-auth-token.0=expired-test-token");
    getClaims.mockImplementationOnce(async () => {
      await cookieMethods.setAll?.([
        { name: "sb-fake-project-auth-token.0", value: "", options: { path: "/", maxAge: 0, httpOnly: true, secure: true, sameSite: "lax" } },
        { name: "sb-fake-project-auth-token.1", value: "", options: { path: "/", maxAge: 0 } },
      ], NO_STORE_HEADERS);
      return { data: null, error: new Error("Expired test session") };
    });

    const response = await updateSession(request);
    const destination = new URL(response.headers.get("location")!);

    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("status")).toBe("session-expired");
    expect(destination.searchParams.get("next")).toBe("/analytics");
    expect(request.cookies.get("sb-fake-project-auth-token.0")?.value).toBe("");
    expect(response.cookies.get("sb-fake-project-auth-token.0")).toMatchObject({
      value: "", path: "/", maxAge: 0, httpOnly: true, secure: true, sameSite: "lax",
    });
    expect(response.cookies.get("sb-fake-project-auth-token.1")).toMatchObject({ value: "", maxAge: 0 });
    expectNoStore(response);
  });

  it.each([
    { url: undefined, key: PUBLIC_KEY },
    { url: PUBLIC_URL, key: undefined },
    { url: undefined, key: undefined },
  ])("preserves preview access when public Supabase configuration is incomplete: %j", async ({ url, key }) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);

    const response = await updateSession(requestFor("/records"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
    expect(getClaims).not.toHaveBeenCalled();
  });
});
