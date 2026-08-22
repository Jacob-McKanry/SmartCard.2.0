import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Wiring tests, not a re-test of `profile-service.ts` (already covered where
 * it lives) or of `route-context.ts` (covered in its own suite). What is
 * unique to THIS file and worth pinning: the right service function is
 * called with the right arguments, the photo URL is paired onto the read the
 * same way the web screen pairs it, and the write path validates before
 * calling the service.
 */

const {
  requireApiContext,
  requireSameOrigin,
  getOwnProfile,
  updateOwnProfile,
  signedProfilePhotoUrl,
} = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  requireSameOrigin: vi.fn(),
  getOwnProfile: vi.fn(),
  updateOwnProfile: vi.fn(),
  signedProfilePhotoUrl: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/profile/profile-service", () => ({ getOwnProfile, updateOwnProfile }));
vi.mock("@/server/profile/photo-url", () => ({ signedProfilePhotoUrl }));

const { GET, PATCH } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
});

afterEach(() => vi.clearAllMocks());

describe("GET /api/v1/profile", () => {
  it("pairs the profile with a signed photo URL, the same way the web screen does", async () => {
    getOwnProfile.mockResolvedValue({ id: "u1", photo_path: "u1/photo.jpg" });
    signedProfilePhotoUrl.mockResolvedValue("https://signed.example/photo.jpg");

    const response = await GET(new Request("https://x/api/v1/profile"));
    const body = await response.json();

    expect(getOwnProfile).toHaveBeenCalledWith(FAKE_SUPABASE, "u1");
    expect(signedProfilePhotoUrl).toHaveBeenCalledWith(FAKE_SUPABASE, "u1/photo.jpg");
    expect(body).toEqual({
      ok: true,
      profile: { id: "u1", photo_path: "u1/photo.jpg" },
      photoUrl: "https://signed.example/photo.jpg",
    });
  });

  it("does not require same-origin — a read has nothing for a forgery to change", async () => {
    getOwnProfile.mockResolvedValue({ id: "u1", photo_path: null });
    signedProfilePhotoUrl.mockResolvedValue(null);

    await GET(new Request("https://x/api/v1/profile"));

    expect(requireSameOrigin).not.toHaveBeenCalled();
  });

  it("401s without ever calling the service, when the caller is not authenticated", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    requireApiContext.mockRejectedValue(new ApiHttpError(401, "You need to be signed in."));

    const response = await GET(new Request("https://x/api/v1/profile"));

    expect(response.status).toBe(401);
    expect(getOwnProfile).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/profile", () => {
  it("checks same-origin, validates, then writes through the caller's own client", async () => {
    updateOwnProfile.mockResolvedValue(undefined);

    const response = await PATCH(
      new Request("https://x/api/v1/profile", {
        method: "PATCH",
        body: JSON.stringify({ bio: "Hi there" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateOwnProfile).toHaveBeenCalledWith(FAKE_SUPABASE, "u1", { bio: "Hi there" });
  });

  it("400s a field outside the update grant, before the service is ever called", async () => {
    const response = await PATCH(
      new Request("https://x/api/v1/profile", {
        method: "PATCH",
        // `is_admin` is not in `userProfileUpdateSchema` on purpose — see the
        // schema's own comment on why the write grant is column-scoped.
        body: JSON.stringify({ is_admin: true }),
      }),
    );

    expect(response.status).toBe(400);
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });

  it("refuses a cross-site write before authenticating or touching the service", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    requireSameOrigin.mockImplementation(() => {
      throw new ApiHttpError(403, "That request wasn't valid.");
    });

    const response = await PATCH(
      new Request("https://x/api/v1/profile", { method: "PATCH", body: "{}" }),
    );

    expect(response.status).toBe(403);
    expect(requireApiContext).not.toHaveBeenCalled();
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });
});
