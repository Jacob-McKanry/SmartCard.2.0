import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { requireApiContext, getHostRsvpQueue } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  getHostRsvpQueue: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext };
});
vi.mock("@/server/events/events-service", () => ({ getHostRsvpQueue }));

const { GET } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const params = Promise.resolve({ eventId: "e1" });

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue({ userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE });
});

afterEach(() => vi.clearAllMocks());

it("returns whatever the RPC answers, including an empty list for a non-host", async () => {
  getHostRsvpQueue.mockResolvedValue([]);

  const response = await GET(new Request("https://x/y"), { params });

  expect(getHostRsvpQueue).toHaveBeenCalledWith(FAKE_SUPABASE, "e1");
  expect(await response.json()).toEqual({ ok: true, entries: [] });
});

it("returns the host's real roster", async () => {
  getHostRsvpQueue.mockResolvedValue([{ rsvpId: "r1", userId: "guest1", status: "pending" }]);

  const response = await GET(new Request("https://x/y"), { params });

  expect(await response.json()).toEqual({
    ok: true,
    entries: [{ rsvpId: "r1", userId: "guest1", status: "pending" }],
  });
});
