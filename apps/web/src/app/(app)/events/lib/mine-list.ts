import type { EventRsvpRow } from "@smartcard/types";

import type { AttendingEventItem, BrowseEventItem } from "@/server/events/events-service";

/**
 * The Attending tab of "My events" (`../mine/page.tsx`) — the union of two
 * things that have never been the same list before now:
 *
 *   listAttendingEvents      every event the caller has answered an RSVP for
 *   listOwnAttendedEvents    every event the caller holds a CLAIMED
 *                            `event_attendee_imports` row for
 *
 * §2.4 of the import design is explicit that these stay two separate facts —
 * "events I attended" was deliberately kept out of the RSVP status enum, see
 * `attended-events-service.ts`'s own header — so this module does not merge
 * them into one status. It only dedupes by event id for the one screen where
 * a person reasonably wants both answered to "was I at this?" in one list,
 * the same way the browse screen's `mergeBrowseList` dedupes four different
 * sources of "can I see this" without collapsing what each one means.
 *
 * An event can be in both lists at once (RSVP'd *and* separately claimed a
 * guest-list row) — the merge keeps the RSVP and adds the claimed flag,
 * rather than picking one arbitrarily.
 */
export interface MyAttendingItem extends BrowseEventItem {
  /** The caller's own RSVP for this event, or `null` if they never answered. */
  rsvp: EventRsvpRow | null;
  /** Whether the caller also holds a claimed guest-list row for this event. */
  attendedViaGuestList: boolean;
}

export function mergeAttendingList(
  rsvped: readonly AttendingEventItem[],
  claimed: readonly BrowseEventItem[],
): MyAttendingItem[] {
  const byId = new Map<string, MyAttendingItem>();

  for (const item of rsvped) {
    byId.set(item.event.id, {
      event: item.event,
      city: item.city,
      rsvp: item.rsvp,
      attendedViaGuestList: false,
    });
  }
  for (const item of claimed) {
    const existing = byId.get(item.event.id);
    if (existing) {
      existing.attendedViaGuestList = true;
    } else {
      byId.set(item.event.id, {
        event: item.event,
        city: item.city,
        rsvp: null,
        attendedViaGuestList: true,
      });
    }
  }
  return [...byId.values()];
}

/**
 * Splits a "my events" list into upcoming (soonest first) and past (most
 * recent first) — the same `starts_at` vs. now definition `browseEvents` and
 * `mergeBrowseList` already use, restated here because this screen's lists
 * never pass through either of those.
 *
 * `nowMs` is a parameter rather than a `Date.now()` call for the same purity
 * reason `mergeBrowseList` takes one: the caller reads the clock once,
 * outside a render body, and a test can pin an ordering whose clock it
 * controls.
 */
export function splitUpcomingPast<T extends BrowseEventItem>(
  items: readonly T[],
  nowMs: number,
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const item of items) {
    (new Date(item.event.starts_at).getTime() >= nowMs ? upcoming : past).push(item);
  }
  upcoming.sort((a, b) => a.event.starts_at.localeCompare(b.event.starts_at));
  past.sort((a, b) => b.event.starts_at.localeCompare(a.event.starts_at));
  return { upcoming, past };
}
