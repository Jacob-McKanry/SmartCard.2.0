import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiContext, requireSameOrigin, updateOwnSocialLink, deleteOwnSocialLink } = vi.hoisted(
  () => ({
    requireApiContext: vi.fn(),
    requireSameOrigin: vi.fn(),
    updateOwnSocialLink: vi.fn(),
    deleteOwnSocialLink: vi.fn(),
  }),
);

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/profile/profile-service", () => ({ updateOwnSocialLink, deleteOwnSocialLink }));

const { PATCH, DELETE } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE };
const params = Promise.resolve({ linkId: "l1" });

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
});

afterEach(() => vi.clearAllMocks());

it("PATCH passes the caller's own id and the URL's linkId to the service, never trusting a body id", async () => {
  updateOwnSocialLink.mockResolvedValue(undefined);

  const response = await PATCH(
    new Request("https://x/y", { method: "PATCH", body: JSON.stringify({ display_order: 2 }) }),
    { params },
  );

  expect(response.status).toBe(200);
  expect(updateOwnSocialLink).toHaveBeenCalledWith(FAKE_SUPABASE, "u1", "l1", { display_order: 2 });
});

it("DELETE scopes by both the URL's linkId and the caller's own id", async () => {
  deleteOwnSocialLink.mockResolvedValue(undefined);

  const response = await DELETE(new Request("https://x/y", { method: "DELETE" }), { params });

  expect(response.status).toBe(200);
  expect(deleteOwnSocialLink).toHaveBeenCalledWith(FAKE_SUPABASE, "u1", "l1");
});

describe("both refuse a cross-site write before touching the service", () => {
  it("PATCH", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    requireSameOrigin.mockImplementation(() => {
      throw new ApiHttpError(403, "That request wasn't valid.");
    });

    const response = await PATCH(new Request("https://x/y", { method: "PATCH", body: "{}" }), { params });

    expect(response.status).toBe(403);
    expect(updateOwnSocialLink).not.toHaveBeenCalled();
  });

  it("DELETE", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    requireSameOrigin.mockImplementation(() => {
      throw new ApiHttpError(403, "That request wasn't valid.");
    });

    const response = await DELETE(new Request("https://x/y", { method: "DELETE" }), { params });

    expect(response.status).toBe(403);
    expect(deleteOwnSocialLink).not.toHaveBeenCalled();
  });
});
