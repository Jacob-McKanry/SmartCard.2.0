import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiContext, requireSameOrigin, decideRsvp } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  requireSameOrigin: vi.fn(),
  decideRsvp: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/events/events-service", () => ({ decideRsvp }));

const { PATCH } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "host1", kindeUserId: "k1", supabase: FAKE_SUPABASE };
const params = Promise.resolve({ eventId: "e1", rsvpId: "r1" });

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
  requireSameOrigin.mockReset();
});

afterEach(() => vi.clearAllMocks());

it("approves with override defaulting to false when omitted", async () => {
  decideRsvp.mockResolvedValue({ ok: true, status: "going", withdrewFromStatus: null, changed: true, promoted: 0 });

  const response = await PATCH(
    new Request("https://x/y", { method: "PATCH", body: JSON.stringify({ decision: "approve" }) }),
    { params },
  );

  expect(response.status).toBe(200);
  expect(decideRsvp).toHaveBeenCalledWith(FAKE_SUPABASE, "r1", "approve", false);
});

it("passes override through when explicitly true", async () => {
  decideRsvp.mockResolvedValue({ ok: true, status: "going", withdrewFromStatus: null, changed: true, promoted: 0 });

  await PATCH(
    new Request("https://x/y", {
      method: "PATCH",
      body: JSON.stringify({ decision: "approve", override: true }),
    }),
    { params },
  );

  expect(decideRsvp).toHaveBeenCalledWith(FAKE_SUPABASE, "r1", "approve", true);
});

it("400s a decision outside the enum, before the RPC is called", async () => {
  const response = await PATCH(
    new Request("https://x/y", { method: "PATCH", body: JSON.stringify({ decision: "maybe" }) }),
    { params },
  );

  expect(response.status).toBe(400);
  expect(decideRsvp).not.toHaveBeenCalled();
});

it("200s the RPC's own not-found-or-not-yours refusal without a special case", async () => {
  decideRsvp.mockResolvedValue({ ok: false, reason: "rsvp_not_found" });

  const response = await PATCH(
    new Request("https://x/y", { method: "PATCH", body: JSON.stringify({ decision: "approve" }) }),
    { params },
  );

  expect(response.status).toBe(200);
  expect((await response.json()).result).toEqual({ ok: false, reason: "rsvp_not_found" });
});

describe("cross-site refusal", () => {
  it("happens before authenticating or calling the RPC", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    requireSameOrigin.mockImplementation(() => {
      throw new ApiHttpError(403, "That request wasn't valid.");
    });

    const response = await PATCH(
      new Request("https://x/y", { method: "PATCH", body: JSON.stringify({ decision: "approve" }) }),
      { params },
    );

    expect(response.status).toBe(403);
    expect(requireApiContext).not.toHaveBeenCalled();
    expect(decideRsvp).not.toHaveBeenCalled();
  });
});
