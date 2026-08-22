import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { requireApiContext, hasCompletedSignup } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  hasCompletedSignup: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext };
});
vi.mock("@/server/onboarding/onboarding-service", () => ({ hasCompletedSignup }));

const { GET } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue({ userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE });
});

afterEach(() => vi.clearAllMocks());

it("reports the caller's own onboarding state", async () => {
  hasCompletedSignup.mockResolvedValue(false);

  const response = await GET(new Request("https://x/api/v1/onboarding"));

  expect(hasCompletedSignup).toHaveBeenCalledWith(FAKE_SUPABASE, "u1");
  expect(await response.json()).toEqual({ ok: true, completed: false });
});
