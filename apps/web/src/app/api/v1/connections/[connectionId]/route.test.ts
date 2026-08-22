import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The heaviest wiring test in this group, because the route reproduces the
 * web page's own multi-branch 404 logic rather than delegating to a single
 * service call. Every branch that must 404 — missing connection, missing
 * meeting, missing counterpart, missing participant row — is asserted
 * separately, because collapsing any one of them into a 500 or a leaked
 * detail would be exactly the disclosure `getConnectionForViewer`'s header
 * says this feature must not make.
 */

const {
  requireApiContext,
  requireSameOrigin,
  getConnectionForViewer,
  getMeetingRecord,
  getMeetingParticipants,
  getMeetingLocation,
  getOtherParticipantProfile,
  removeConnection,
  signedProfilePhotoUrl,
} = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  requireSameOrigin: vi.fn(),
  getConnectionForViewer: vi.fn(),
  getMeetingRecord: vi.fn(),
  getMeetingParticipants: vi.fn(),
  getMeetingLocation: vi.fn(),
  getOtherParticipantProfile: vi.fn(),
  removeConnection: vi.fn(),
  signedProfilePhotoUrl: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/connections/connections-service", () => ({
  getConnectionForViewer,
  getMeetingRecord,
  getMeetingParticipants,
  getMeetingLocation,
  getOtherParticipantProfile,
  removeConnection,
}));
vi.mock("@/server/profile/photo-url", () => ({ signedProfilePhotoUrl }));

const { GET, DELETE } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "me", kindeUserId: "k1", supabase: FAKE_SUPABASE };
const params = Promise.resolve({ connectionId: "c1" });

const CONNECTION = {
  id: "c1",
  user_a_id: "me",
  user_b_id: "them",
  origin_meeting_id: "m1",
  status: "active",
};

function healthyCollaborators() {
  getConnectionForViewer.mockResolvedValue(CONNECTION);
  getMeetingRecord.mockResolvedValue({ id: "m1" });
  getMeetingParticipants.mockResolvedValue([
    { meeting_id: "m1", user_id: "me" },
    { meeting_id: "m1", user_id: "them" },
  ]);
  getMeetingLocation.mockResolvedValue(null);
  getOtherParticipantProfile.mockResolvedValue({ id: "them", photo_path: null });
  signedProfilePhotoUrl.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
  // `mockImplementation` (used below to make this throw) survives
  // `clearAllMocks`, which only clears call history — reset it explicitly so
  // one test's "refuse" behaviour cannot leak into the next test's happy path.
  requireSameOrigin.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe("GET", () => {
  it("assembles the full detail view on the happy path", async () => {
    healthyCollaborators();

    const response = await GET(new Request("https://x/y"), { params });
    const body = await response.json();

    expect(getMeetingRecord).toHaveBeenCalledWith(FAKE_SUPABASE, "m1");
    expect(getOtherParticipantProfile).toHaveBeenCalledWith(FAKE_SUPABASE, "them");
    expect(body.ok).toBe(true);
    expect(body.otherUser).toEqual({ id: "them", photo_path: null });
  });

  it("derives the OTHER participant correctly when the caller is user_b", async () => {
    getConnectionForViewer.mockResolvedValue({ ...CONNECTION, user_a_id: "them", user_b_id: "me" });
    getMeetingRecord.mockResolvedValue({ id: "m1" });
    getMeetingParticipants.mockResolvedValue([
      { meeting_id: "m1", user_id: "me" },
      { meeting_id: "m1", user_id: "them" },
    ]);
    getMeetingLocation.mockResolvedValue(null);
    getOtherParticipantProfile.mockResolvedValue({ id: "them", photo_path: null });
    signedProfilePhotoUrl.mockResolvedValue(null);

    await GET(new Request("https://x/y"), { params });

    expect(getOtherParticipantProfile).toHaveBeenCalledWith(FAKE_SUPABASE, "them");
  });

  it("404s a connection that doesn't exist or isn't the caller's, with no distinguishing detail", async () => {
    getConnectionForViewer.mockResolvedValue(null);

    const response = await GET(new Request("https://x/y"), { params });

    expect(response.status).toBe(404);
    expect(getMeetingRecord).not.toHaveBeenCalled();
  });

  it("404s when the meeting is missing", async () => {
    getConnectionForViewer.mockResolvedValue(CONNECTION);
    getMeetingRecord.mockResolvedValue(null);
    getMeetingParticipants.mockResolvedValue([]);
    getMeetingLocation.mockResolvedValue(null);
    getOtherParticipantProfile.mockResolvedValue({ id: "them", photo_path: null });

    const response = await GET(new Request("https://x/y"), { params });

    expect(response.status).toBe(404);
  });

  it("404s when the counterpart's profile no longer resolves (e.g. a deleted account)", async () => {
    getConnectionForViewer.mockResolvedValue(CONNECTION);
    getMeetingRecord.mockResolvedValue({ id: "m1" });
    getMeetingParticipants.mockResolvedValue([{ meeting_id: "m1", user_id: "me" }]);
    getMeetingLocation.mockResolvedValue(null);
    getOtherParticipantProfile.mockResolvedValue(null);

    const response = await GET(new Request("https://x/y"), { params });

    expect(response.status).toBe(404);
  });

  it("404s when a participant row is missing for either party", async () => {
    getConnectionForViewer.mockResolvedValue(CONNECTION);
    getMeetingRecord.mockResolvedValue({ id: "m1" });
    // Only the caller's row exists — the counterpart's participant row is gone.
    getMeetingParticipants.mockResolvedValue([{ meeting_id: "m1", user_id: "me" }]);
    getMeetingLocation.mockResolvedValue(null);
    getOtherParticipantProfile.mockResolvedValue({ id: "them", photo_path: null });

    const response = await GET(new Request("https://x/y"), { params });

    expect(response.status).toBe(404);
  });

  it("does not require same-origin for a read", async () => {
    healthyCollaborators();
    await GET(new Request("https://x/y"), { params });
    expect(requireSameOrigin).not.toHaveBeenCalled();
  });
});

describe("DELETE", () => {
  it("removes the connection through the caller's own client", async () => {
    removeConnection.mockResolvedValue(undefined);

    const response = await DELETE(new Request("https://x/y", { method: "DELETE" }), { params });

    expect(response.status).toBe(200);
    expect(removeConnection).toHaveBeenCalledWith(FAKE_SUPABASE, "c1");
  });

  it("refuses a cross-site request before touching the service", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    requireSameOrigin.mockImplementation(() => {
      throw new ApiHttpError(403, "That request wasn't valid.");
    });

    const response = await DELETE(new Request("https://x/y", { method: "DELETE" }), { params });

    expect(response.status).toBe(403);
    expect(removeConnection).not.toHaveBeenCalled();
  });

  it("surfaces the service's own UserFacingError for an already-removed connection", async () => {
    const { UserFacingError } = await import("@/server/errors");
    removeConnection.mockRejectedValue(
      new UserFacingError("This connection couldn't be removed — it may already be gone."),
    );

    const response = await DELETE(new Request("https://x/y", { method: "DELETE" }), { params });

    expect(response.status).toBe(400);
    expect((await response.json()).message).toMatch(/already be gone/);
  });
});
