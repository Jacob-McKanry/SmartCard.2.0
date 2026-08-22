import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiContext, requireSameOrigin, requestRsvp, withdrawRsvp } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  requireSameOrigin: vi.fn(),
  requestRsvp: vi.fn(),
  withdrawRsvp: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/events/events-service", () => ({ requestRsvp, withdrawRsvp }));

const { POST, DELETE } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE };
const params = Promise.resolve({ eventId: "e1" });

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
  requireSameOrigin.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe("POST", () => {
  it("forwards a valid intent and renders the RETURNED status, not the sent one", async () => {
    // The RPC legitimately stores something other than what was asked (a full
    // event stores `waitlist` for a `going` request) — the route must not
    // assume the two match.
    requestRsvp.mockResolvedValue({ ok: true, status: "waitlist", changed: true, promoted: 0 });

    const response = await POST(
      new Request("https://x/y", { method: "POST", body: JSON.stringify({ intent: "going" }) }),
      { params },
    );
    const body = await response.json();

    expect(requestRsvp).toHaveBeenCalledWith(FAKE_SUPABASE, "e1", "going");
    expect(response.status).toBe(200);
    expect(body.result.status).toBe("waitlist");
  });

  it("200s an RPC-level refusal — it is an ordinary answer, not an HTTP error", async () => {
    requestRsvp.mockResolvedValue({ ok: false, reason: "event_full" });

    const response = await POST(
      new Request("https://x/y", { method: "POST", body: JSON.stringify({ intent: "going" }) }),
      { params },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).result).toEqual({ ok: false, reason: "event_full" });
  });

  it("400s an intent outside the enum, before the service is called", async () => {
    const response = await POST(
      new Request("https://x/y", { method: "POST", body: JSON.stringify({ intent: "maybe" }) }),
      { params },
    );

    expect(response.status).toBe(400);
    expect(requestRsvp).not.toHaveBeenCalled();
  });

  it("refuses a cross-site request before authenticating", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    requireSameOrigin.mockImplementation(() => {
      throw new ApiHttpError(403, "That request wasn't valid.");
    });

    const response = await POST(new Request("https://x/y", { method: "POST", body: "{}" }), { params });

    expect(response.status).toBe(403);
    expect(requireApiContext).not.toHaveBeenCalled();
  });
});

describe("DELETE", () => {
  it("withdraws through the service", async () => {
    withdrawRsvp.mockResolvedValue({ ok: true, status: null, withdrewFromStatus: "going", changed: true, promoted: 1 });

    const response = await DELETE(new Request("https://x/y", { method: "DELETE" }), { params });
    const body = await response.json();

    expect(withdrawRsvp).toHaveBeenCalledWith(FAKE_SUPABASE, "e1");
    expect(body.result.withdrewFromStatus).toBe("going");
  });

  it("refuses a cross-site request before touching the service", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    requireSameOrigin.mockImplementation(() => {
      throw new ApiHttpError(403, "That request wasn't valid.");
    });

    const response = await DELETE(new Request("https://x/y", { method: "DELETE" }), { params });

    expect(response.status).toBe(403);
    expect(withdrawRsvp).not.toHaveBeenCalled();
  });
});
