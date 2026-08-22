import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiContext, listOwnConnections } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  listOwnConnections: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext };
});
vi.mock("@/server/connections/connections-service", () => ({ listOwnConnections }));

const { GET } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
});

afterEach(() => vi.clearAllMocks());

it("lists the caller's own connections", async () => {
  listOwnConnections.mockResolvedValue([{ connectionId: "c1" }]);

  const response = await GET(new Request("https://x/api/v1/connections"));

  expect(listOwnConnections).toHaveBeenCalledWith(FAKE_SUPABASE, "u1");
  expect(await response.json()).toEqual({ ok: true, connections: [{ connectionId: "c1" }] });
});

describe("a database failure never reaches the response", () => {
  it("collapses to the generic message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listOwnConnections.mockRejectedValue(new Error('permission denied for table "connections"'));

    const response = await GET(new Request("https://x/api/v1/connections"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).not.toMatch(/permission denied|connections/i);

    spy.mockRestore();
  });
});
