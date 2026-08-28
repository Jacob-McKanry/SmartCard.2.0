import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiContext, requireSameOrigin, browseEvents, createEvent } = vi.hoisted(() => ({
  requireApiContext: vi.fn(),
  requireSameOrigin: vi.fn(),
  browseEvents: vi.fn(),
  createEvent: vi.fn(),
}));

vi.mock("@/server/api/route-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/route-context")>();
  return { ...actual, requireApiContext, requireSameOrigin };
});
vi.mock("@/server/events/events-service", () => ({ browseEvents, createEvent }));

const { GET, POST } = await import("./route");

const FAKE_SUPABASE = { marker: "supabase" };
const context = { userId: "u1", kindeUserId: "k1", supabase: FAKE_SUPABASE };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiContext.mockResolvedValue(context);
  requireSameOrigin.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe("GET", () => {
  it("defaults to upcoming with no city filter", async () => {
    browseEvents.mockResolvedValue([]);

    await GET(new Request("https://x/api/v1/events"));

    expect(browseEvents).toHaveBeenCalledWith(FAKE_SUPABASE, { cityId: undefined, when: "upcoming" });
  });

  it("passes city and when through from the query string", async () => {
    browseEvents.mockResolvedValue([]);

    await GET(new Request("https://x/api/v1/events?city=c1&when=past"));

    expect(browseEvents).toHaveBeenCalledWith(FAKE_SUPABASE, { cityId: "c1", when: "past" });
  });

  it("treats any unrecognised `when` value as upcoming rather than passing it through", async () => {
    browseEvents.mockResolvedValue([]);

    await GET(new Request("https://x/api/v1/events?when=yesterday"));

    expect(browseEvents).toHaveBeenCalledWith(FAKE_SUPABASE, { cityId: undefined, when: "upcoming" });
  });
});

describe("POST", () => {
  it("creates the event with the caller as host, never a body-supplied host", async () => {
    createEvent.mockResolvedValue({ id: "e1", host_user_id: "u1" });

    const response = await POST(
      new Request("https://x/api/v1/events", {
        method: "POST",
        body: JSON.stringify({
          city_id: "11111111-1111-4111-8111-111111111111",
          title: "Meetup",
          starts_at: "2026-09-01T18:00:00Z",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createEvent).toHaveBeenCalledWith(
      FAKE_SUPABASE,
      "u1",
      expect.objectContaining({ title: "Meetup" }),
    );
  });

  it("400s a body missing required fields, before the service is called", async () => {
    const response = await POST(
      new Request("https://x/api/v1/events", { method: "POST", body: JSON.stringify({}) }),
    );

    expect(response.status).toBe(400);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("refuses a cross-site create before authenticating", async () => {
    const { ApiHttpError } = await import("@/server/api/route-context");
    requireSameOrigin.mockImplementation(() => {
      throw new ApiHttpError(403, "That request wasn't valid.");
    });

    const response = await POST(new Request("https://x/api/v1/events", { method: "POST", body: "{}" }));

    expect(response.status).toBe(403);
    expect(requireApiContext).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });
});
