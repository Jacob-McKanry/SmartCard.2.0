import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiContext, listFeedItems } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  listFeedItems: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext };
});
vi.mock("@/server/feed/feed-service", () => ({ listFeedItems }));

const { GET } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
});

afterEach(() => vi.clearAllMocks());

it("returns every item the service resolves for the caller", async () => {
  listFeedItems.mockResolvedValue([{ kind: "participant", meetingId: "m1" }]);

  const response = await GET(new Request("https://x/api/v1/feed"));

  expect(listFeedItems).toHaveBeenCalledWith(FAKE_SUPABASE, "u1");
  expect(await response.json()).toEqual({ ok: true, items: [{ kind: "participant", meetingId: "m1" }] });
});

it("401s without calling the service, when unauthenticated", async () => {
  const { ApiHttpError } = await import("@/server/api/route-context");
  requireApiContext.mockRejectedValue(new ApiHttpError(401, "You need to be signed in."));

  const response = await GET(new Request("https://x/api/v1/feed"));

  expect(response.status).toBe(401);
  expect(listFeedItems).not.toHaveBeenCalled();
});

describe("a database failure never reaches the response", () => {
  it("collapses to the generic message rather than the raw PostgREST error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listFeedItems.mockRejectedValue(new Error('permission denied for table "meetings"'));

    const response = await GET(new Request("https://x/api/v1/feed"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).not.toMatch(/permission denied|meetings/i);

    spy.mockRestore();
  });
});
