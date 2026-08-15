import type { RsvpIntent, RsvpStatus } from "@smartcard/types";

import type { EventAttendanceCounts, HostQueueEntry } from "@/server/events/events-service";

/**
 * THE ACCESS RULES OF THE EVENTS SCREENS, AS FUNCTIONS RATHER THAN AS HABITS.
 *
 * Every rule in this file is a rule about *what a screen may render*, not about
 * what the database will hand over. The database is already the enforcement
 * point and none of this is a security boundary: RLS decides which events come
 * back, `event_attendance_counts` decides whether `pending` is a number or
 * `null`, and `event_rsvp_queue` returns nothing at all to a non-host. If every
 * line below were deleted, nobody would gain access to anything.
 *
 * What deleting it *would* do is remove the one place these rules are stated
 * once and can be tested. That is the whole point. A leak in this feature does
 * not look like a broken policy — it looks like somebody adding a perfectly
 * reasonable-seeming line of JSX that maps over data the page already,
 * legitimately, holds. Keeping the decisions in pure functions means
 * `access-rules.test.ts` can assert the rules as rules, and a future edit that
 * quietly re-adds a guest list has to walk past a failing test to do it.
 *
 * THE RULES, IN THE ORDER THEY MATTER
 *
 *  1. THE ATTENDEE LIST IS NOBODY'S. No screen renders a list of who is
 *     attending an event — not to a stranger, not to an attendee, and not to
 *     the host. See `decidableQueueEntries` for the one place this bites a
 *     design detail, and why it costs nothing.
 *
 *  2. COUNTS ARE PUBLIC, NAMES ARE NOT. Going / interested / waitlist and
 *     seats-remaining are visible to anyone who can see the event.
 *     **The pending count is host-only.** `publicStats` is the only thing the
 *     screens use to build the stat row, and it cannot express `pending`.
 *
 *  3. "YOU KNOW N GOING" IS A NUMBER, NEVER A ROSTER. `getConnectionsAttending`
 *     returns `{ going: string[]; interested: string[] }` — *user ids*, not
 *     counts. That it hands back identities does not mean a screen may draw
 *     them: a list of "your connections who are going" is still a list of who
 *     is attending, merely filtered to people you happen to know, and rule 1
 *     has no exception for a partial list. `connectionsAttendingLine` therefore
 *     takes the summary and returns a *sentence built from `.length`*, so the
 *     ids never reach a component in the first place.
 *
 *  4. STORED STATE, NEVER THE TAPPED INTENT. Tapping "going" may store
 *     `pending` or `waitlist`. `rsvpMismatchNotice` produces the sentence that
 *     says so; the pill always renders the stored status.
 */

/**
 * How the viewer relates to this event. Derived from data the page already has
 * — never from a URL, a form field, or the absence of an error.
 *
 * `host` is `events.host_user_id === viewerId`, which is the same fact the
 * database checks with `private.is_event_host`. It is used here only to decide
 * what to *draw*; every host-only action re-derives it server-side.
 */
export type ViewerRole = "host" | "answered" | "onlooker";

export function viewerRole(
  hostUserId: string,
  viewerId: string,
  ownRsvp: { status: RsvpStatus } | null,
): ViewerRole {
  if (hostUserId === viewerId) return "host";
  return ownRsvp === null ? "onlooker" : "answered";
}

// ---------------------------------------------------------------------------
// Rule 2 — counts are public, the pending count is host-only
// ---------------------------------------------------------------------------

export interface EventStat {
  key: "going" | "interested" | "waitlist" | "seats";
  value: string;
  label: string;
}

/**
 * The four-stat row from `DESIGN.md` §6, for **any** viewer who can see the
 * event.
 *
 * Note the return type: `EventStat["key"]` has no `pending` member, so a stat
 * row built from this function cannot show a pending count even by accident.
 * That is deliberate — a `pending` key filtered out at render time would be one
 * `.filter()` away from being rendered, whereas a key that does not exist is a
 * type error.
 *
 * `seats` is "unlimited" rather than a number when `capacity` is null, because
 * that is what the column means and "0 seats left" would be the opposite of
 * the truth. `seatsRemaining` is already clamped at zero by the RPC even after
 * a host admits somebody past the cap, so this never renders a negative.
 */
export function publicStats(counts: EventAttendanceCounts): EventStat[] {
  return [
    { key: "going", value: String(counts.going), label: "going" },
    { key: "interested", value: String(counts.interested), label: "interested" },
    { key: "waitlist", value: String(counts.waitlist), label: "waitlisted" },
    {
      key: "seats",
      value: counts.seatsRemaining === null ? "∞" : String(counts.seatsRemaining),
      label: counts.seatsRemaining === null ? "no cap" : "seats left",
    },
  ];
}

/**
 * The host's own queue depth, or `null` for everybody else.
 *
 * Two independent gates, and both are meant to be here. The RPC already returns
 * `pending: null` to a non-host, so the second half of this expression is the
 * one that actually does the work in production. The `role` check exists so
 * that a future change which loosened the RPC — or a page that fetched counts
 * with the wrong client — could not turn a non-host's screen into a queue-depth
 * readout without this function changing too. Fail closed (CLAUDE.md): if the
 * viewer is not known to be the host, the answer is `null`.
 */
export function hostPendingCount(counts: EventAttendanceCounts, role: ViewerRole): number | null {
  if (role !== "host") return null;
  return counts.pending;
}

// ---------------------------------------------------------------------------
// Rule 1 — no attendee list, for anybody
// ---------------------------------------------------------------------------

/**
 * The rows the host approval queue may draw: the ones awaiting a decision.
 *
 * WHERE THIS OVERRULES A DESIGN DETAIL, AND WHY IT COSTS NOTHING
 *
 * `event_rsvp_queue` (20260814051200) deliberately returns `going` rows as well
 * as `pending` and `waitlist`, and `docs/design-lab-reference.md` describes the
 * queue as showing all three. Drawing the `going` rows would put a list of
 * names of people attending an event on a screen, which is rule 1, and rule 1
 * has no host exception. So they are dropped here.
 *
 * The reason this is a free trade rather than a compromise: a `going` row is
 * **not decidable**. `deriveDecidedRsvp` in `@smartcard/core` — and
 * `public.decide_event_rsvp`, which is the copy that counts — refuse anything
 * that is not `pending` or `waitlist` with `not_decidable`. Approving someone
 * already approved does nothing; denying them would be an *eject*, which this
 * product deliberately does not have. So the `going` rows in that RPC's result
 * can only ever be looked at, and "a list of attendees, to look at" is the
 * exact thing there is no version of in this product. The host keeps every
 * action they had, and the count of who is going is still on the event page
 * for them and for everyone else.
 *
 * Ordering is oldest-first: a queue is answered in the order people joined it,
 * and it is the same order `private.promote_event_waitlist` promotes in.
 */
export function decidableQueueEntries(entries: readonly HostQueueEntry[]): HostQueueEntry[] {
  return entries
    .filter((entry) => entry.status === "pending" || entry.status === "waitlist")
    .sort((a, b) => {
      if (a.respondedAt !== b.respondedAt) return a.respondedAt < b.respondedAt ? -1 : 1;
      // Same tie-break as `waitlistOrder` in @smartcard/core, so a position
      // shown here names the person the database would actually promote.
      return a.rsvpId < b.rsvpId ? -1 : a.rsvpId > b.rsvpId ? 1 : 0;
    });
}

// ---------------------------------------------------------------------------
// Rule 3 — "you know N going" is a number
// ---------------------------------------------------------------------------

/**
 * Q21's two separately-labelled counts as one sentence, or `null` when there is
 * nothing to say.
 *
 * Takes the summary and returns a string. It never returns the ids, and no
 * caller is given the option — see rule 3 in the header. The two counts stay
 * separate (never summed) for the reason `summarizeConnectionsAttending`'s own
 * comment gives: "5 of your connections will be there" is a promise the data
 * does not support when two of them tapped *maybe*.
 *
 * `null` rather than "0 going" when nobody is: §7's "absence is often normal",
 * and a zero here would also be a small, repeated statement about who you do
 * not know.
 */
export function connectionsAttendingLine(summary: {
  going: readonly string[];
  interested: readonly string[];
}): string | null {
  const going = summary.going.length;
  const interested = summary.interested.length;

  if (going === 0 && interested === 0) return null;
  if (interested === 0) return `You know ${going} going`;
  if (going === 0) return `You know ${interested} interested`;
  return `You know ${going} going · ${interested} interested`;
}

// ---------------------------------------------------------------------------
// Rule 4 — render stored state, and say so when it differs from the tap
// ---------------------------------------------------------------------------

/**
 * The sentence explaining why what the person tapped is not what the app now
 * holds — or `null` when the two agree and there is nothing to explain.
 *
 * §7: "Tapping 'going' may store pending or waitlist; the screen shows what was
 * stored, and says so when the two differ." The pill elsewhere always renders
 * `stored`; this only produces the explanation that goes beside it.
 *
 * `stored` may be `null`, which is a withdrawal — no row, therefore no answer.
 * That is not a mismatch, it is the absence of one, so it produces nothing.
 */
export function rsvpMismatchNotice(intent: RsvpIntent, stored: RsvpStatus | null): string | null {
  if (stored === null || stored === intent) return null;

  if (intent === "going" && stored === "pending") {
    return "You asked to go. This host approves each guest, so your answer is stored as a request, not a seat.";
  }
  if (intent === "going" && stored === "waitlist") {
    return "You asked to go. The event is full, so your answer is stored as a waitlist place — you move up automatically the moment a seat frees.";
  }
  // Any other disagreement means the database's rules and this UI's
  // expectations have drifted. Say the true thing (what is stored) rather than
  // inventing an explanation for a case nobody designed.
  return `You asked to be ${intentWord(intent)}. What's stored is ${statusWord(stored)}.`;
}

function intentWord(intent: RsvpIntent): string {
  switch (intent) {
    case "going":
      return "going";
    case "interested":
      return "interested";
    case "not_going":
      return "not going";
  }
}

function statusWord(status: RsvpStatus): string {
  switch (status) {
    case "going":
      return "going";
    case "interested":
      return "interested";
    case "not_going":
      return "not going";
    case "pending":
      return "waiting on the host";
    case "waitlist":
      return "waitlisted";
    case "denied":
      return "not admitted";
  }
}
