import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiContext, requireSameOrigin, listOwnSocialLinks, addOwnSocialLink } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  requireSameOrigin: vi.fn(),
  listOwnSocialLinks: vi.fn(),
  addOwnSocialLink: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/profile/profile-service", () => ({ listOwnSocialLinks, addOwnSocialLink }));

const { GET, POST } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
});

afterEach(() => vi.clearAllMocks());

it("GET lists the caller's own links, scoped by their id", async () => {
  listOwnSocialLinks.mockResolvedValue([{ id: "l1", platform: "instagram" }]);

  const response = await GET(new Request("https://x/api/v1/profile/social-links"));

  expect(listOwnSocialLinks).toHaveBeenCalledWith(FAKE_SUPABASE, "u1");
  expect(await response.json()).toEqual({ ok: true, links: [{ id: "l1", platform: "instagram" }] });
});

describe("POST", () => {
  it("adds a link through the service, and never accepts a client-supplied user_id", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    addOwnSocialLink.mockResolvedValue({ id: "l1", platform: "instagram", url: "https://instagram.com/x" });

    const response = await POST(
      new Request("https://x/api/v1/profile/social-links", {
        method: "POST",
        body: JSON.stringify({ platform: "instagram", url: "https://instagram.com/x" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(addOwnSocialLink).toHaveBeenCalledWith(FAKE_SUPABASE, "u1", {
      platform: "instagram",
      url: "https://instagram.com/x",
      display_order: 0,
    });

    // `user_id` in the body is a `.strict()` schema violation, not a value
    // that gets through and is then ignored.
    void ApiHttpError;
  });

  it("400s a body carrying user_id, before the service is ever called", async () => {
    const response = await POST(
      new Request("https://x/api/v1/profile/social-links", {
        method: "POST",
        body: JSON.stringify({ platform: "x", url: "https://x.com/y", user_id: "someone-else" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(addOwnSocialLink).not.toHaveBeenCalled();
  });

  it("refuses a cross-site write before touching the service", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    requireSameOrigin.mockImplementation(() => {
      throw new ApiHttpError(403, "That request wasn't valid.");
    });

    const response = await POST(
      new Request("https://x/api/v1/profile/social-links", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(403);
    expect(addOwnSocialLink).not.toHaveBeenCalled();
  });
});
