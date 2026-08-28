import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiContext,
  requireSameOrigin,
  getEventForViewer,
  getOwnRsvp,
  getEventAttendanceCounts,
  getConnectionsAttending,
  getEventHostProfile,
  getOwnConnectionsAtEvent,
  updateOwnEvent,
  signedEventCoverUrl,
  signedProfilePhotoUrl,
} = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  requireSameOrigin: vi.fn(),
  getEventForViewer: vi.fn(),
  getOwnRsvp: vi.fn(),
  getEventAttendanceCounts: vi.fn(),
  getConnectionsAttending: vi.fn(),
  getEventHostProfile: vi.fn(),
  getOwnConnectionsAtEvent: vi.fn(),
  updateOwnEvent: vi.fn(),
  signedEventCoverUrl: vi.fn(),
  signedProfilePhotoUrl: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/events/events-service", () => ({
  getEventForViewer,
  getOwnRsvp,
  getEventAttendanceCounts,
  getConnectionsAttending,
  getEventHostProfile,
  getOwnConnectionsAtEvent,
  updateOwnEvent,
}));
vi.mock("@/server/events/cover-url", () => ({ signedEventCoverUrl }));
vi.mock("@/server/profile/photo-url", () => ({ signedProfilePhotoUrl }));

const { GET, PATCH } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE };
const params = Promise.resolve({ eventId: "e1" });

function healthyCollaborators() {
  getEventForViewer.mockResolvedValue({
    event: { id: "e1", host_user_id: "host1", cover_image_path: null },
    city: { id: "c1", name: "Austin" },
  });
  getOwnRsvp.mockResolvedValue(null);
  getEventAttendanceCounts.mockResolvedValue({ going: 3, interested: 1, waitlist: 0 });
  getConnectionsAttending.mockResolvedValue({ going: [], interested: [] });
  getEventHostProfile.mockResolvedValue({ id: "host1", photo_path: null });
  getOwnConnectionsAtEvent.mockResolvedValue(2);
  signedEventCoverUrl.mockResolvedValue(null);
  signedProfilePhotoUrl.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
  requireSameOrigin.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe("GET", () => {
  it("assembles all eight pieces the web detail page renders", async () => {
    healthyCollaborators();

    const response = await GET(new Request("https://x/y"), { params });
    const body = await response.json();

    expect(getOwnRsvp).toHaveBeenCalledWith(FAKE_SUPABASE, "e1", "u1");
    expect(getOwnConnectionsAtEvent).toHaveBeenCalledWith(FAKE_SUPABASE, "e1", "u1");
    expect(getEventHostProfile).toHaveBeenCalledWith(FAKE_SUPABASE, "host1");
    expect(body).toMatchObject({
      ok: true,
      event: { id: "e1" },
      city: { id: "c1" },
      counts: { going: 3 },
      ownConnectionsHere: 2,
    });
  });

  it("does not sign a host photo URL when there is no readable host profile", async () => {
    healthyCollaborators();
    getEventHostProfile.mockResolvedValue(null);

    const response = await GET(new Request("https://x/y"), { params });
    const body = await response.json();

    expect(signedProfilePhotoUrl).not.toHaveBeenCalled();
    expect(body.hostPhotoUrl).toBeNull();
    expect(body.host).toBeNull();
  });

  it("404s an event that doesn't exist or isn't visible to the caller", async () => {
    getEventForViewer.mockResolvedValue(null);

    const response = await GET(new Request("https://x/y"), { params });

    expect(response.status).toBe(404);
    expect(getOwnRsvp).not.toHaveBeenCalled();
  });

  it("does not require same-origin for a read", async () => {
    healthyCollaborators();
    await GET(new Request("https://x/y"), { params });
    expect(requireSameOrigin).not.toHaveBeenCalled();
  });
});

describe("PATCH", () => {
  it("updates through the service, scoped by the caller's own id", async () => {
    updateOwnEvent.mockResolvedValue(undefined);

    const response = await PATCH(
      new Request("https://x/y", { method: "PATCH", body: JSON.stringify({ title: "New title" }) }),
      { params },
    );

    expect(response.status).toBe(200);
    expect(updateOwnEvent).toHaveBeenCalledWith(FAKE_SUPABASE, "u1", "e1", { title: "New title" });
  });

  it("refuses a cross-site write before authenticating", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    requireSameOrigin.mockImplementation(() => {
      throw new ApiHttpError(403, "That request wasn't valid.");
    });

    const response = await PATCH(new Request("https://x/y", { method: "PATCH", body: "{}" }), { params });

    expect(response.status).toBe(403);
    expect(requireApiContext).not.toHaveBeenCalled();
    expect(updateOwnEvent).not.toHaveBeenCalled();
  });

  it("surfaces the service's own UserFacingError for a non-host", async () => {
    const { UserFacingError } = await import("@/server/errors");
    updateOwnEvent.mockRejectedValue(
      new UserFacingError("That event couldn't be updated — you may not be its host."),
    );

    const response = await PATCH(
      new Request("https://x/y", { method: "PATCH", body: JSON.stringify({ title: "x" }) }),
      { params },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).message).toMatch(/may not be its host/);
  });
});
