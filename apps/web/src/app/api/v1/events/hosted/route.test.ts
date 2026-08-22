import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { requireApiContext, listHostedEvents } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  listHostedEvents: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext };
});
vi.mock("@/server/events/events-service", () => ({ listHostedEvents }));

const { GET } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue({ userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE });
});

afterEach(() => vi.clearAllMocks());

it("lists events the caller hosts", async () => {
  listHostedEvents.mockResolvedValue([{ event: { id: "e1" } }]);

  const response = await GET(new Request("https://x/api/v1/events/hosted"));

  expect(listHostedEvents).toHaveBeenCalledWith(FAKE_SUPABASE, "u1");
  expect(await response.json()).toEqual({ ok: true, items: [{ event: { id: "e1" } }] });
});
