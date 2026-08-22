import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiContext, requireSameOrigin, listEventInvites, inviteToEvent } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  requireSameOrigin: vi.fn(),
  listEventInvites: vi.fn(),
  inviteToEvent: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/events/events-service", () => ({ listEventInvites, inviteToEvent }));

const { GET, POST } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE };
const params = Promise.resolve({ eventId: "e1" });
const VALID_UUID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
  requireSameOrigin.mockReset();
});

afterEach(() => vi.clearAllMocks());

it("GET returns whatever RLS scopes the answer to, no extra filtering", async () => {
  listEventInvites.mockResolvedValue([{ id: "i1", event_id: "e1" }]);

  const response = await GET(new Request("https://x/y"), { params });

  expect(listEventInvites).toHaveBeenCalledWith(FAKE_SUPABASE, "e1");
  expect(await response.json()).toEqual({ ok: true, invites: [{ id: "i1", event_id: "e1" }] });
});

describe("POST", () => {
  it("invites with the caller as inviter, never a body-supplied one", async () => {
    inviteToEvent.mockResolvedValue(undefined);

    const response = await POST(
      new Request("https://x/y", {
        method: "POST",
        body: JSON.stringify({ invitedUserId: VALID_UUID, invitedByUserId: "someone-else" }),
      }),
      { params },
    );

    expect(response.status).toBe(200);
    expect(inviteToEvent).toHaveBeenCalledWith(FAKE_SUPABASE, "e1", "u1", VALID_UUID);
  });

  it("400s a malformed invitedUserId, before the service is called", async () => {
    const response = await POST(
      new Request("https://x/y", { method: "POST", body: JSON.stringify({ invitedUserId: "not-a-uuid" }) }),
      { params },
    );

    expect(response.status).toBe(400);
    expect(inviteToEvent).not.toHaveBeenCalled();
  });

  it("refuses a cross-site invite before authenticating", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    requireSameOrigin.mockImplementation(() => {
      throw new ApiHttpError(403, "That request wasn't valid.");
    });

    const response = await POST(new Request("https://x/y", { method: "POST", body: "{}" }), { params });

    expect(response.status).toBe(403);
    expect(requireApiContext).not.toHaveBeenCalled();
  });

  it("surfaces the INSERT policy's own refusal (e.g. inviting a non-connection) as a plain error", async () => {
    inviteToEvent.mockRejectedValue(new Error("new row violates row-level security policy"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      new Request("https://x/y", { method: "POST", body: JSON.stringify({ invitedUserId: VALID_UUID }) }),
      { params },
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).not.toMatch(/row-level security/i);

    spy.mockRestore();
  });
});
