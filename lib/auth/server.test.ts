import { beforeEach, describe, expect, it, vi } from "vitest";

import { hasVerifiedSession } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const getClaims = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createClient).mockResolvedValue({ auth: { getClaims } } as unknown as NonNullable<Awaited<ReturnType<typeof createClient>>>);
});

describe("verified entry session", () => {
  it("accepts only error-free user claims", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-a" } }, error: null });
    expect(await hasVerifiedSession()).toBe(true);
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-a" } }, error: new Error("invalid") });
    expect(await hasVerifiedSession()).toBe(false);
  });

  it("treats missing configuration and unavailable auth as unauthenticated", async () => {
    vi.mocked(createClient).mockResolvedValueOnce(null);
    expect(await hasVerifiedSession()).toBe(false);
    getClaims.mockRejectedValue(new Error("network"));
    expect(await hasVerifiedSession()).toBe(false);
  });
});
