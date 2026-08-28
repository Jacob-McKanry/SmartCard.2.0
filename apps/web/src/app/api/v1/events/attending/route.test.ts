import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { requireApiContext, listAttendingEvents } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  listAttendingEvents: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext };
});
vi.mock("@/server/events/events-service", () => ({ listAttendingEvents }));

const { GET } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue({ userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE });
});

afterEach(() => vi.clearAllMocks());

it("lists every event the caller has answered for", async () => {
  listAttendingEvents.mockResolvedValue([{ event: { id: "e1" }, rsvp: { status: "going" } }]);

  const response = await GET(new Request("https://x/api/v1/events/attending"));

  expect(listAttendingEvents).toHaveBeenCalledWith(FAKE_SUPABASE, "u1");
  expect(await response.json()).toEqual({
    ok: true,
    items: [{ event: { id: "e1" }, rsvp: { status: "going" } }],
  });
});
