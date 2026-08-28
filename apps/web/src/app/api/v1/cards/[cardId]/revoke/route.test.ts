import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiContext, requireSameOrigin, revokeCard } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  requireSameOrigin: vi.fn(),
  revokeCard: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/cards/cards-service", () => ({ revokeCard }));

const { POST } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE };
const params = Promise.resolve({ cardId: "c1" });

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
  requireSameOrigin.mockReset();
});

afterEach(() => vi.clearAllMocks());

it("revokes through the service, scoped by the caller's own id", async () => {
  revokeCard.mockResolvedValue(undefined);

  const response = await POST(new Request("https://x/y", { method: "POST" }), { params });

  expect(response.status).toBe(200);
  expect(revokeCard).toHaveBeenCalledWith(FAKE_SUPABASE, "c1", "u1");
});

it("refuses a cross-site request before authenticating or touching the service", async () => {
  const { ApiHttpError } = await import("@/server/api/route-context");
  requireSameOrigin.mockImplementation(() => {
    throw new ApiHttpError(403, "That request wasn't valid.");
  });

  const response = await POST(new Request("https://x/y", { method: "POST" }), { params });

  expect(response.status).toBe(403);
  expect(requireApiContext).not.toHaveBeenCalled();
  expect(revokeCard).not.toHaveBeenCalled();
});

describe("a card that isn't the caller's, or is already revoked", () => {
  it("surfaces the service's own UserFacingError, not a distinct status", async () => {
    const { UserFacingError } = await import("@/server/errors");
    revokeCard.mockRejectedValue(
      new UserFacingError("This card couldn't be revoked — it may already be revoked or isn't yours."),
    );

    const response = await POST(new Request("https://x/y", { method: "POST" }), { params });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toMatch(/already be revoked or isn't yours/);
  });
});
