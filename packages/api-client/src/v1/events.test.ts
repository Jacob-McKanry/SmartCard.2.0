import { describe, expect, it, vi } from "vitest";

import {
  ApiV1Error,
  browseEvents,
  createEvent,
  decideRsvp,
  getEvent,
  getHostQueue,
  inviteToEvent,
  listCities,
  requestRsvp,
  withdrawRsvp,
} from "../index";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const CITY = { id: "11111111-1111-4111-8111-111111111111", slug: "austin", name: "Austin", state: "TX", is_active: true, created_at: "2026-08-01T00:00:00.000Z" };
/** `browseEventItemSchema`/`eventDetailResponseSchema` only pick these four columns off `cities`. */
const CITY_SUMMARY = { id: CITY.id, slug: CITY.slug, name: CITY.name, state: CITY.state };
const EVENT = {
  id: "22222222-2222-4222-8222-222222222222",
  host_user_id: "33333333-3333-4333-8333-333333333333",
  city_id: CITY.id,
  title: "Meetup",
  description: null,
  starts_at: "2026-09-01T18:00:00.000Z",
  ends_at: null,
  timezone: null,
  venue_name: null,
  venue_address: null,
  latitude: null,
  longitude: null,
  visibility: "public",
  capacity: null,
  requires_approval: false,
  cover_image_path: null,
  status: "scheduled",
  cancelled_at: null,
  cancelled_reason: null,
  created_at: "2026-08-01T00:00:00.000Z",
};

describe("listCities", () => {
  it("returns the parsed list", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, cities: [CITY] }));
    await expect(listCities({ fetchImpl })).resolves.toEqual([CITY]);
  });
});

describe("browseEvents", () => {
  it("sends no query string when no options are given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, items: [] }));

    await browseEvents({}, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/events", expect.anything());
  });

  it("encodes city and when into the query string", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, items: [] }));

    await browseEvents({ cityId: CITY.id, when: "past" }, { fetchImpl });

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe(`/api/v1/events?city=${CITY.id}&when=past`);
  });

  it("returns the parsed items", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, items: [{ event: EVENT, city: CITY }] }));

    await expect(browseEvents({}, { fetchImpl })).resolves.toEqual([{ event: EVENT, city: CITY_SUMMARY }]);
  });
});

describe("createEvent", () => {
  it("posts and returns the created event", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { ok: true, event: EVENT }));

    const result = await createEvent(
      { city_id: CITY.id, title: "Meetup", starts_at: "2026-09-01T18:00:00.000Z" },
      { fetchImpl },
    );

    expect(result).toEqual(EVENT);
  });

  it("rejects an insert missing required fields before ever calling fetch", async () => {
    const fetchImpl = vi.fn();

    // @ts-expect-error -- missing required fields
    await expect(createEvent({}, { fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("getEvent", () => {
  const DETAIL = {
    ok: true,
    event: EVENT,
    city: CITY_SUMMARY,
    ownRsvp: null,
    counts: { going: 1, interested: 0, waitlist: 0, pending: null, capacity: null, seatsRemaining: null, isFull: false, connectionsMade: 0 },
    connectionsAttending: { going: [], interested: [] },
    host: null,
    hostPhotoUrl: null,
    coverUrl: null,
    ownConnectionsHere: 0,
  };

  it("returns the full assembly on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, DETAIL));

    await expect(getEvent(EVENT.id, { fetchImpl })).resolves.toEqual(DETAIL);
  });

  it("returns null for a 404 rather than throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { ok: false, message: "No such event." }));

    await expect(getEvent("does-not-exist", { fetchImpl })).resolves.toBeNull();
  });

  it("still throws for anything that is NOT a 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { ok: false, message: "Something went wrong." }));

    await expect(getEvent(EVENT.id, { fetchImpl })).rejects.toBeInstanceOf(ApiV1Error);
  });
});

describe("RSVP mutations render the RETURNED status, not the sent intent", () => {
  it("requestRsvp", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true, result: { ok: true, status: "waitlist", withdrewFromStatus: null, changed: true, promoted: 0 } }));

    const result = await requestRsvp(EVENT.id, "going", { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ intent: "going" });
    expect(result).toEqual({ ok: true, status: "waitlist", withdrewFromStatus: null, changed: true, promoted: 0 });
  });

  it("requestRsvp surfaces an RPC-level refusal as a normal return value, not a thrown error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, result: { ok: false, reason: "event_full" } }));

    await expect(requestRsvp(EVENT.id, "going", { fetchImpl })).resolves.toEqual({ ok: false, reason: "event_full" });
  });

  it("withdrawRsvp issues a DELETE with no body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, result: { ok: true, status: null, withdrewFromStatus: "going", changed: true, promoted: 1 } }));

    await withdrawRsvp(EVENT.id, { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });
});

describe("getHostQueue", () => {
  it("returns whatever the RPC answers, including an empty list for a non-host", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, entries: [] }));

    await expect(getHostQueue(EVENT.id, { fetchImpl })).resolves.toEqual([]);
  });
});

describe("decideRsvp", () => {
  it("defaults override to false when omitted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, result: { ok: true, status: "going", withdrewFromStatus: null, changed: true, promoted: 0 } }));

    await decideRsvp(EVENT.id, "rsvp-1", "approve", undefined, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/events/${EVENT.id}/queue/rsvp-1`);
    expect(JSON.parse(init.body as string)).toEqual({ decision: "approve", override: false });
  });
});

describe("inviteToEvent", () => {
  it("rejects a malformed invitedUserId before calling fetch", async () => {
    const fetchImpl = vi.fn();

    await expect(inviteToEvent(EVENT.id, "not-a-uuid", { fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts a well-formed invitedUserId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await inviteToEvent(EVENT.id, CITY.id, { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ invitedUserId: CITY.id });
  });
});
