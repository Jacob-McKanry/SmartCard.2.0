import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { requireApiContext, requireSameOrigin, getConnectionForViewer, setOwnParticipantFlags } =
  vi.hoisted(() => ({
    requireApiContext: vi.fn(),
    requireSameOrigin: vi.fn(),
    getConnectionForViewer: vi.fn(),
    setOwnParticipantFlags: vi.fn(),
  }));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/connections/connections-service", () => ({
  getConnectionForViewer,
  setOwnParticipantFlags,
}));

const { PATCH } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "me", kindeUserId: "k1", supabase: FAKE_SUPABASE };
const params = Promise.resolve({ connectionId: "c1" });

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
  getConnectionForViewer.mockResolvedValue({ id: "c1", origin_meeting_id: "m1" });
});

afterEach(() => vi.clearAllMocks());

it("writes only the caller's own flags, scoped by their own userId and the derived meetingId", async () => {
  setOwnParticipantFlags.mockResolvedValue(undefined);

  const response = await PATCH(
    new Request("https://x/y", {
      method: "PATCH",
      body: JSON.stringify({ location_share_consent: true }),
    }),
    { params },
  );

  expect(response.status).toBe(200);
  expect(setOwnParticipantFlags).toHaveBeenCalledWith(FAKE_SUPABASE, "m1", "me", {
    location_share_consent: true,
  });
});

/**
 * A body-supplied meeting id is not just unused, it must be IMPOSSIBLE to
 * supply — there is no code path here that reads a `meetingId` field off the
 * body at all. Asserted explicitly, with a bogus value present in the
 * request, because a version of this route that read `body.meetingId ??
 * connection.origin_meeting_id` would pass the test above (which never sends
 * one) while still letting a caller redirect the write at any meeting id they
 * choose.
 */
it("ignores a meetingId supplied in the body, using only the one derived from the connection", async () => {
  setOwnParticipantFlags.mockResolvedValue(undefined);

  await PATCH(
    new Request("https://x/y", {
      method: "PATCH",
      body: JSON.stringify({ location_share_consent: true, meetingId: "someone-elses-meeting" }),
    }),
    { params },
  );

  expect(setOwnParticipantFlags).toHaveBeenCalledWith(
    FAKE_SUPABASE,
    "m1",
    "me",
    expect.not.objectContaining({ meetingId: expect.anything() }),
  );
  expect(setOwnParticipantFlags.mock.calls[0]?.[1]).toBe("m1");
});

it("404s when the connection doesn't resolve", async () => {
  getConnectionForViewer.mockResolvedValue(null);

  const response = await PATCH(new Request("https://x/y", { method: "PATCH", body: "{}" }), { params });

  expect(response.status).toBe(404);
  expect(setOwnParticipantFlags).not.toHaveBeenCalled();
});

it("refuses a cross-site write before touching the connection lookup", async () => {
  const { ApiHttpError } = await import("@/server/api/route-context");
  requireSameOrigin.mockImplementation(() => {
    throw new ApiHttpError(403, "That request wasn't valid.");
  });

  const response = await PATCH(new Request("https://x/y", { method: "PATCH", body: "{}" }), { params });

  expect(response.status).toBe(403);
  expect(getConnectionForViewer).not.toHaveBeenCalled();
});
