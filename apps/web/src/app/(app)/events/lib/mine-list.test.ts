import { describe, expect, it } from "vitest";
import type { EventRsvpRow } from "@smartcard/types";
import type { AttendingEventItem, BrowseEventItem } from "@/server/events/events-service";

import { mergeAttendingList, splitUpcomingPast } from "./mine-list";

/**
 * `mergeAttendingList` and `splitUpcomingPast` — the two pure functions
 * behind "My events" → Attending (`../mine/page.tsx`). Mirrors
 * `browse-list.test.ts`'s own shape: these are product-merge tests, not
 * security tests — RLS already decided which RSVP rows and which claimed
 * import rows the caller may read before either function saw them.
 */

const NOW = Date.parse("2026-08-15T12:00:00.000Z");

function item(over: { id: string; startsAt?: string }): BrowseEventItem {
  return {
    event: {
      id: over.id,
      host_user_id: "host-1",
      city_id: "city-1",
      title: over.id,
      description: null,
      starts_at: over.startsAt ?? "2026-09-01T18:00:00.000Z",
      ends_at: null,
      timezone: "UTC",
      venue_name: null,
      venue_address: null,
      latitude: null,
      longitude: null,
      visibility: "private",
      capacity: null,
      requires_approval: false,
      cover_image_path: null,
      status: "scheduled",
      cancelled_at: null,
      cancelled_reason: null,
      created_at: "2026-08-01T00:00:00.000Z",
    },
    city: { id: "city-1", slug: "sf", name: "San Francisco", state: "CA" },
  };
}

function rsvp(over: { status?: EventRsvpRow["status"] } = {}): EventRsvpRow {
  return {
    id: "rsvp-1",
    event_id: "event-1",
    user_id: "user-1",
    status: over.status ?? "going",
    responded_at: "2026-08-10T00:00:00.000Z",
    decided_by: null,
    decided_at: null,
    capacity_override: false,
  };
}

function attending(over: { id: string; startsAt?: string; status?: EventRsvpRow["status"] }): AttendingEventItem {
  return { ...item(over), rsvp: rsvp({ status: over.status }) };
}

describe("mergeAttendingList", () => {
  it("keeps an RSVP'd event with no claimed row, rsvp set and attendedViaGuestList false", () => {
    const merged = mergeAttendingList([attending({ id: "rsvp-only" })], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.rsvp?.status).toBe("going");
    expect(merged[0]?.attendedViaGuestList).toBe(false);
  });

  it("keeps a claimed-only event with no RSVP, rsvp null and attendedViaGuestList true", () => {
    const merged = mergeAttendingList([], [item({ id: "claimed-only" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.rsvp).toBeNull();
    expect(merged[0]?.attendedViaGuestList).toBe(true);
  });

  it("merges one event that is both RSVP'd and claimed into a single row with both facts", () => {
    const merged = mergeAttendingList(
      [attending({ id: "both", status: "interested" })],
      [item({ id: "both" })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.rsvp?.status).toBe("interested");
    expect(merged[0]?.attendedViaGuestList).toBe(true);
  });

  it("never drops the RSVP status when adding the claimed flag", () => {
    const merged = mergeAttendingList(
      [attending({ id: "a", status: "pending" }), attending({ id: "b", status: "waitlist" })],
      [item({ id: "a" })],
    );
    const byId = new Map(merged.map((row) => [row.event.id, row]));
    expect(byId.get("a")?.rsvp?.status).toBe("pending");
    expect(byId.get("b")?.rsvp?.status).toBe("waitlist");
  });
});

describe("splitUpcomingPast", () => {
  it("splits on starts_at against nowMs, upcoming soonest-first, past most-recent-first", () => {
    const rows = [
      item({ id: "future-far", startsAt: "2026-10-01T18:00:00.000Z" }),
      item({ id: "future-near", startsAt: "2026-09-01T18:00:00.000Z" }),
      item({ id: "past-recent", startsAt: "2026-08-01T18:00:00.000Z" }),
      item({ id: "past-older", startsAt: "2026-06-01T18:00:00.000Z" }),
    ];

    const { upcoming, past } = splitUpcomingPast(rows, NOW);

    expect(upcoming.map((r) => r.event.id)).toEqual(["future-near", "future-far"]);
    expect(past.map((r) => r.event.id)).toEqual(["past-recent", "past-older"]);
  });

  it("treats an event starting exactly now as upcoming", () => {
    const rows = [item({ id: "now", startsAt: new Date(NOW).toISOString() })];
    const { upcoming, past } = splitUpcomingPast(rows, NOW);
    expect(upcoming.map((r) => r.event.id)).toEqual(["now"]);
    expect(past).toEqual([]);
  });
});
