import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { requireApiContext, listActiveCities } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  listActiveCities: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext };
});
vi.mock("@/server/events/events-service", () => ({ listActiveCities }));

const { GET } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue({ userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE });
});

afterEach(() => vi.clearAllMocks());

it("lists active cities through the caller's own client", async () => {
  listActiveCities.mockResolvedValue([{ id: "c1", name: "Austin" }]);

  const response = await GET(new Request("https://x/api/v1/cities"));

  expect(listActiveCities).toHaveBeenCalledWith(FAKE_SUPABASE);
  expect(await response.json()).toEqual({ ok: true, cities: [{ id: "c1", name: "Austin" }] });
});
