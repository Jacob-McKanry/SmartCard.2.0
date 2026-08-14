import type { RsvpDecision, RsvpIntent, RsvpStatus } from "@smartcard/types";

/**
 * The RSVP rules of §2.6's Events feature, as pure functions.
 *
 * WHAT THIS FILE IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT
 *
 * It is NOT the enforcement point, and nothing here is a security boundary.
 * The database is: `public.request_event_rsvp` and `public.decide_event_rsvp`
 * (`supabase/migrations/20260814051200_fn_event_rsvp_write_path.sql`) compute
 * every stored status inside one transaction, holding a row lock on the event,
 * from values they read themselves. `authenticated` holds no INSERT, UPDATE or
 * DELETE grant on `event_rsvps` at all, so there is no path by which a caller
 * could use this module — or bypass it — to write anything.
 *
 * It exists because a UI has to be able to say, *before* the person taps,
 * "this event needs the host's approval" or "this will put you on the
 * waitlist", and because "you are 3rd in line" is a real thing to show
 * somebody. Answering those questions by writing a row and reading back what
 * happened is not an option, so the truth table has to exist in TypeScript
 * too.
 *
 * THE DUPLICATION IS THE HAZARD, SO IT IS NAMED HERE RATHER THAN LEFT IMPLICIT
 * Two copies of a rule drift. When they drift, this one is wrong by definition:
 * the SQL decides what is stored, and a disagreement shows up as a UI that
 * promised "you're going" and a database that said `waitlist`. That is a
 * confusing UI, not a hole — the failure mode of drift here is embarrassment,
 * never over-admission — but the direction of authority still needs to be
 * unambiguous. If the SQL changes, change this file in the same commit, and
 * change `rsvp-rules.test.ts`, which is written as the shared truth table both
 * are supposed to satisfy.
 */

// ---------------------------------------------------------------------------
// Requesting: what happens when a person asks for something
// ---------------------------------------------------------------------------

export interface RsvpRequestContext {
  /** What the person is asking for. Outcomes (`pending`/`waitlist`/`denied`) are not askable. */
  intent: RsvpIntent;
  requiresApproval: boolean;
  /** `null` means unlimited — the same encoding the column uses. */
  capacity: number | null;
  /** How many `going` RSVPs the event already has. */
  goingCount: number;
  /** The person's existing status, or `null` if they have never answered. */
  currentStatus: RsvpStatus | null;
  /** `coalesce(ends_at, starts_at) < now()` — computed by the caller. */
  hasEnded: boolean;
}

export type RsvpRequestOutcome =
  | { outcome: "stored"; status: RsvpStatus; changed: boolean }
  | { outcome: "refused"; reason: "event_ended" };

/**
 * What `public.request_event_rsvp` will store for this request.
 *
 * The branches, in the same order the SQL evaluates them:
 *
 *  1. A late `going` on an event that has already ended is refused. Not
 *     tidiness: two `going` RSVPs to one event make two strangers' profiles
 *     mutually readable (`private.shares_event_with`, §3.4), so without this
 *     every past event is a permanent standing invitation to read the profile
 *     of anyone who attended it. Someone who is *already* `going` is exempt —
 *     re-affirming changes nothing, and erroring at them would be noise.
 *  2. `interested` and `not_going` are stored as asked. Neither takes a seat
 *     and neither needs anyone's permission.
 *  3. Someone already `going` stays `going`. Re-affirming must not demote a
 *     person the host already approved back into `pending`.
 *  4. An approval-gated event stores `pending` — before any capacity test, so
 *     unapproved requests cannot occupy seats.
 *  5. A full event stores `waitlist`.
 *  6. Otherwise `going`.
 */
export function deriveRequestedRsvp(context: RsvpRequestContext): RsvpRequestOutcome {
  const { intent, requiresApproval, capacity, goingCount, currentStatus, hasEnded } = context;

  if (intent === "going" && hasEnded && currentStatus !== "going") {
    return { outcome: "refused", reason: "event_ended" };
  }

  let status: RsvpStatus;
  if (intent !== "going") {
    status = intent;
  } else if (currentStatus === "going") {
    status = "going";
  } else if (requiresApproval) {
    status = "pending";
  } else if (isFull(capacity, goingCount)) {
    status = "waitlist";
  } else {
    status = "going";
  }

  return { outcome: "stored", status, changed: currentStatus !== status };
}

// ---------------------------------------------------------------------------
// Deciding: what happens when a host acts on somebody else's request
// ---------------------------------------------------------------------------

export interface RsvpDecisionContext {
  decision: RsvpDecision;
  /** The status of the row being decided on. */
  currentStatus: RsvpStatus;
  capacity: number | null;
  goingCount: number;
  /** The host explicitly chose to admit past a full event's cap. */
  override: boolean;
  hasEnded: boolean;
}

export type RsvpDecisionOutcome =
  | { outcome: "stored"; status: RsvpStatus; capacityOverride: boolean }
  | { outcome: "refused"; reason: "not_decidable" | "event_ended" };

/**
 * What `public.decide_event_rsvp` will store for this decision.
 *
 * Only `pending` and `waitlist` rows are decidable, and the two exclusions are
 * deliberate rather than incidental:
 *
 *  - Deny on an already-`going` row would be an *eject*, which is a different
 *    product action with different consequences from refusing a request, and
 *    was not asked for. It also means no decision can ever free a seat, which
 *    is why deciding never triggers waitlist promotion.
 *  - Approve on a `denied` row would push somebody to `going` — and therefore
 *    make their profile readable to co-attendees — without any act of theirs
 *    since being told no. The way back from a denial is the person asking
 *    again.
 *
 * `capacityOverride` is true only when the override actually did something. A
 * host who passes the flag at an event with room has not overridden anything,
 * and recording that they had would make the column a log of which button was
 * pressed rather than an answer to "was a rule set aside for this row".
 */
export function deriveDecidedRsvp(context: RsvpDecisionContext): RsvpDecisionOutcome {
  const { decision, currentStatus, capacity, goingCount, override, hasEnded } = context;

  if (currentStatus !== "pending" && currentStatus !== "waitlist") {
    return { outcome: "refused", reason: "not_decidable" };
  }

  if (decision === "deny") {
    return { outcome: "stored", status: "denied", capacityOverride: false };
  }

  if (hasEnded) {
    return { outcome: "refused", reason: "event_ended" };
  }

  if (!isFull(capacity, goingCount)) {
    return { outcome: "stored", status: "going", capacityOverride: false };
  }
  if (override) {
    return { outcome: "stored", status: "going", capacityOverride: true };
  }
  return { outcome: "stored", status: "waitlist", capacityOverride: false };
}

/**
 * `null` capacity is unlimited, so it is never full. Written once and used by
 * both derivations because "is this event full" appearing twice with a subtly
 * different null check is exactly the bug this whole module is trying not to
 * have.
 */
export function isFull(capacity: number | null, goingCount: number): boolean {
  return capacity !== null && goingCount >= capacity;
}

/** `null` when capacity is unlimited; never negative, even past an override. */
export function seatsRemaining(capacity: number | null, goingCount: number): number | null {
  return capacity === null ? null : Math.max(capacity - goingCount, 0);
}

// ---------------------------------------------------------------------------
// The waitlist queue
// ---------------------------------------------------------------------------

export interface WaitlistEntry {
  rsvpId: string;
  userId: string;
  /** ISO-8601, as PostgREST serialises `timestamptz`. */
  respondedAt: string;
}

/**
 * The waitlist in the order it will actually be promoted: FIFO by when each
 * person joined it.
 *
 * `rsvpId` is a tie-break, not decoration. Two rows can share a `respondedAt`
 * (the same statement, or a coarse clock), and without a deterministic second
 * key two callers sorting the same list can disagree about who is next — so
 * "you are 3rd" and the promotion the database actually performs could name
 * different people. The SQL orders by `(responded_at, id)` for the same
 * reason; this must stay identical to it.
 */
export function waitlistOrder(entries: readonly WaitlistEntry[]): WaitlistEntry[] {
  return [...entries].sort((a, b) => {
    if (a.respondedAt !== b.respondedAt) {
      return a.respondedAt < b.respondedAt ? -1 : 1;
    }
    return a.rsvpId < b.rsvpId ? -1 : a.rsvpId > b.rsvpId ? 1 : 0;
  });
}

/**
 * Who would be promoted if `seatsFree` seats opened up right now, in order.
 * `null` seats means unlimited — everybody waiting gets in, which is what
 * happens when a host clears an event's capacity.
 */
export function nextWaitlistPromotions(
  entries: readonly WaitlistEntry[],
  seatsFree: number | null,
): WaitlistEntry[] {
  const ordered = waitlistOrder(entries);
  if (seatsFree === null) {
    return ordered;
  }
  return seatsFree <= 0 ? [] : ordered.slice(0, seatsFree);
}

/** 1-based position in the queue, or `null` if this person is not on it. */
export function waitlistPositionOf(
  entries: readonly WaitlistEntry[],
  userId: string,
): number | null {
  const index = waitlistOrder(entries).findIndex((entry) => entry.userId === userId);
  return index === -1 ? null : index + 1;
}

// ---------------------------------------------------------------------------
// The two-count "who's going" hook (§2.6 amendment, Q21)
// ---------------------------------------------------------------------------

export interface ConnectionAttendingRow {
  user_id: string;
  status: string;
}

export interface ConnectionsAttendingSummary {
  going: string[];
  interested: string[];
}

/**
 * Splits `public.connections_attending()`'s rows into the two separately
 * labelled buckets Q21 resolved on — "3 going, 2 interested" — and not into one
 * combined number.
 *
 * The reason for the split is a product one and worth keeping next to the code
 * that could so easily undo it: a single "5 of your connections will be there"
 * is a promise the data does not support, because two of those five tapped a
 * button meaning *maybe*, and a hook that overstates gets checked against
 * reality the moment somebody walks in and counts.
 *
 * Anything that is neither `going` nor `interested` is dropped rather than
 * bucketed somewhere. The RPC already filters to those two, so a third value
 * arriving here means the SQL and this file have diverged, and silently
 * inventing a home for it would hide that.
 */
export function summarizeConnectionsAttending(
  rows: readonly ConnectionAttendingRow[],
): ConnectionsAttendingSummary {
  const going: string[] = [];
  const interested: string[] = [];
  for (const row of rows) {
    if (row.status === "going") {
      going.push(row.user_id);
    } else if (row.status === "interested") {
      interested.push(row.user_id);
    }
  }
  return { going, interested };
}
