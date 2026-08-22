import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiContext, requireSameOrigin, claimUnassignedCard } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  requireSameOrigin: vi.fn(),
  claimUnassignedCard: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/cards/card-claim-service", () => ({ claimUnassignedCard }));

const { POST } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE };
const GOOD_CODE = "CUSTOM-f2a930bcb5fe";

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
  requireSameOrigin.mockReset();
});

afterEach(() => vi.clearAllMocks());

it("claims a well-shaped code through the caller's own client", async () => {
  claimUnassignedCard.mockResolvedValue({ claimed: true });

  const response = await POST(
    new Request("https://x/y", { method: "POST", body: JSON.stringify({ code: GOOD_CODE }) }),
  );

  expect(response.status).toBe(200);
  expect(claimUnassignedCard).toHaveBeenCalledWith(FAKE_SUPABASE, GOOD_CODE);
});

it("400s a malformed code before the RPC is ever called", async () => {
  const response = await POST(
    new Request("https://x/y", { method: "POST", body: JSON.stringify({ code: "not a code" }) }),
  );

  expect(response.status).toBe(400);
  expect(claimUnassignedCard).not.toHaveBeenCalled();
});

describe("a refused claim", () => {
  it("renders ONE message, indistinguishable from any other refusal reason", async () => {
    claimUnassignedCard.mockResolvedValue({ claimed: false });

    const response = await POST(
      new Request("https://x/y", { method: "POST", body: JSON.stringify({ code: GOOD_CODE }) }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).not.toMatch(/revoked|unassigned|assigned|unknown/i);
  });
});

it("refuses a cross-site claim before authenticating", async () => {
  const { ApiHttpError } = await import("@/server/api/route-context");
  requireSameOrigin.mockImplementation(() => {
    throw new ApiHttpError(403, "That request wasn't valid.");
  });

  const response = await POST(
    new Request("https://x/y", { method: "POST", body: JSON.stringify({ code: GOOD_CODE }) }),
  );

  expect(response.status).toBe(403);
  expect(requireApiContext).not.toHaveBeenCalled();
  expect(claimUnassignedCard).not.toHaveBeenCalled();
});
