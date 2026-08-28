import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiContext, requireSameOrigin, getConnectionForViewer, setMeetingLocationVisibility } =
  vi.hoisted(() => ({
    requireApiContext: vi.fn(),
    requireSameOrigin: vi.fn(),
    getConnectionForViewer: vi.fn(),
    setMeetingLocationVisibility: vi.fn(),
  }));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/connections/connections-service", () => ({
  getConnectionForViewer,
  setMeetingLocationVisibility,
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

it("derives the meeting id from the caller's own connection, not from the body", async () => {
  setMeetingLocationVisibility.mockResolvedValue(undefined);

  const response = await PATCH(
    new Request("https://x/y", {
      method: "PATCH",
      // A malicious/buggy client naming a DIFFERENT meeting id is simply ignored —
      // there is no field this schema even accepts for it.
      body: JSON.stringify({ location_visibility: "mutuals", meetingId: "someone-elses-meeting" }),
    }),
    { params },
  );

  expect(response.status).toBe(200);
  expect(setMeetingLocationVisibility).toHaveBeenCalledWith(FAKE_SUPABASE, "m1", {
    location_visibility: "mutuals",
  });
});

it("404s when the connection doesn't resolve, before any write is attempted", async () => {
  getConnectionForViewer.mockResolvedValue(null);

  const response = await PATCH(new Request("https://x/y", { method: "PATCH", body: "{}" }), { params });

  expect(response.status).toBe(404);
  expect(setMeetingLocationVisibility).not.toHaveBeenCalled();
});

describe("cross-site refusal happens before authentication or the connection lookup", () => {
  it("refuses and touches nothing else", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    requireSameOrigin.mockImplementation(() => {
      throw new ApiHttpError(403, "That request wasn't valid.");
    });

    const response = await PATCH(new Request("https://x/y", { method: "PATCH", body: "{}" }), { params });

    expect(response.status).toBe(403);
    expect(requireApiContext).not.toHaveBeenCalled();
    expect(getConnectionForViewer).not.toHaveBeenCalled();
  });
});
