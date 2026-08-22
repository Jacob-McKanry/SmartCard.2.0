import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { requireApiContext, requireSameOrigin, assertSignupCompleted } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  requireSameOrigin: vi.fn(),
  assertSignupCompleted: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/onboarding/onboarding-service", () => ({ assertSignupCompleted }));

const { POST } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
  requireSameOrigin.mockReset();
});

afterEach(() => vi.clearAllMocks());

it("completes onboarding without writing anything to the profile", async () => {
  assertSignupCompleted.mockResolvedValue(undefined);

  const response = await POST(new Request("https://x/y", { method: "POST" }));

  expect(response.status).toBe(200);
  expect(assertSignupCompleted).toHaveBeenCalledWith("u1");
});

it("refuses a cross-site request before authenticating", async () => {
  const { ApiHttpError } = await import("@/server/api/route-context");
  requireSameOrigin.mockImplementation(() => {
    throw new ApiHttpError(403, "That request wasn't valid.");
  });

  const response = await POST(new Request("https://x/y", { method: "POST" }));

  expect(response.status).toBe(403);
  expect(requireApiContext).not.toHaveBeenCalled();
  expect(assertSignupCompleted).not.toHaveBeenCalled();
});
