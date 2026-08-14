import { describe, expect, it } from "vitest";

import {
  deriveDecidedRsvp,
  deriveRequestedRsvp,
  isFull,
  nextWaitlistPromotions,
  seatsRemaining,
  summarizeConnectionsAttending,
  waitlistOrder,
  waitlistPositionOf,
  type RsvpDecisionContext,
  type RsvpRequestContext,
  type WaitlistEntry,
} from "./rsvp-rules";

/**
 * The shared truth table for the Events RSVP rules.
 *
 * These tests are written against the same cases the SQL in
 * `20260814051200_fn_event_rsvp_write_path.sql` implements, because the SQL is
 * the enforcement point and this module is a mirror of it (see that file's
 * header, and this module's). Every case below was also exercised against the
 * live database as a simulated authenticated user during the Events build —
 * these are the fast, offline half of that check, and the half that will still
 * be run by `pnpm turbo test` a year from now.
 *
 * They are adversarial in the same sense the Connect Flow's are: the
 * interesting cases are a client asking for an outcome it is not allowed to
 * assert, a host acting on somebody else's row, a full event, and a queue with
 * ambiguous ordering — not the happy path, which is one line.
 *
 * Proportionality note, deliberately recorded: Events is real but is not the
 * physical-proximity verification layer. There is no attacker here who gains a
 * connection, a location, or a graph edge; the worst outcome a bug in these
 * rules produces is somebody in a room they should not be in, or a queue in the
 * wrong order. The suite is sized for that.
 */

function request(over: Partial<RsvpRequestContext> = {}): RsvpRequestContext {
  return {
    intent: "going",
    requiresApproval: false,
    capacity: null,
    goingCount: 0,
    currentStatus: null,
    hasEnded: false,
    ...over,
  };
}

function decision(over: Partial<RsvpDecisionContext> = {}): RsvpDecisionContext {
  return {
    decision: "approve",
    currentStatus: "pending",
    capacity: null,
    goingCount: 0,
    override: false,
    hasEnded: false,
    ...over,
  };
}

describe("deriveRequestedRsvp — capacity", () => {
  it("stores going when the event is unlimited", () => {
    expect(deriveRequestedRsvp(request({ capacity: null, goingCount: 999 }))).toEqual({
      outcome: "stored",
      status: "going",
      changed: true,
    });
  });

  it("stores going while there is a seat left", () => {
    expect(deriveRequestedRsvp(request({ capacity: 10, goingCount: 9 })).outcome).toBe("stored");
    expect(deriveRequestedRsvp(request({ capacity: 10, goingCount: 9 }))).toMatchObject({
      status: "going",
    });
  });

  it("waitlists the request that arrives exactly at capacity", () => {
    expect(deriveRequestedRsvp(request({ capacity: 10, goingCount: 10 }))).toMatchObject({
      status: "waitlist",
    });
  });

  it("waitlists past capacity — an over-full event (a recorded host override) does not reopen", () => {
    expect(deriveRequestedRsvp(request({ capacity: 10, goingCount: 11 }))).toMatchObject({
      status: "waitlist",
    });
  });

  it("never lets `interested` consume a seat, even at a full event", () => {
    expect(
      deriveRequestedRsvp(request({ intent: "interested", capacity: 1, goingCount: 1 })),
    ).toMatchObject({ status: "interested" });
  });
});

describe("deriveRequestedRsvp — the approval gate", () => {
  it("forces pending regardless of what the client asked for", () => {
    expect(deriveRequestedRsvp(request({ requiresApproval: true }))).toMatchObject({
      status: "pending",
    });
  });

  it("forces pending even when the event has plenty of room", () => {
    expect(
      deriveRequestedRsvp(request({ requiresApproval: true, capacity: 100, goingCount: 0 })),
    ).toMatchObject({ status: "pending" });
  });

  it("prefers pending over waitlist at a full approval-gated event, so unapproved requests hold no seat", () => {
    expect(
      deriveRequestedRsvp(request({ requiresApproval: true, capacity: 1, goingCount: 1 })),
    ).toMatchObject({ status: "pending" });
  });

  it("does not demote somebody the host already approved back to pending", () => {
    expect(
      deriveRequestedRsvp(request({ requiresApproval: true, currentStatus: "going" })),
    ).toEqual({ outcome: "stored", status: "going", changed: false });
  });

  it("puts a re-request after a denial back into pending, not straight to going", () => {
    expect(
      deriveRequestedRsvp(request({ requiresApproval: true, currentStatus: "denied" })),
    ).toMatchObject({ status: "pending" });
  });

  it("re-requesting after a denial at a non-approval event still respects capacity", () => {
    expect(
      deriveRequestedRsvp(
        request({ requiresApproval: false, currentStatus: "denied", capacity: 1, goingCount: 1 }),
      ),
    ).toMatchObject({ status: "waitlist" });
  });
});

describe("deriveRequestedRsvp — events that have already ended", () => {
  it("refuses a new going RSVP to a past event", () => {
    expect(deriveRequestedRsvp(request({ hasEnded: true }))).toEqual({
      outcome: "refused",
      reason: "event_ended",
    });
  });

  it("refuses it for somebody who was merely interested — that is still a NEW attendance claim", () => {
    expect(deriveRequestedRsvp(request({ hasEnded: true, currentStatus: "interested" }))).toEqual({
      outcome: "refused",
      reason: "event_ended",
    });
  });

  it("still allows interested and not_going on a past event — neither grants anything", () => {
    expect(
      deriveRequestedRsvp(request({ intent: "interested", hasEnded: true })).outcome,
    ).toBe("stored");
    expect(deriveRequestedRsvp(request({ intent: "not_going", hasEnded: true })).outcome).toBe(
      "stored",
    );
  });

  it("lets somebody already going re-affirm without an error", () => {
    expect(deriveRequestedRsvp(request({ hasEnded: true, currentStatus: "going" }))).toEqual({
      outcome: "stored",
      status: "going",
      changed: false,
    });
  });
});

describe("deriveRequestedRsvp — `changed` reports a real transition", () => {
  it("is false when the derived status equals the current one", () => {
    expect(
      deriveRequestedRsvp(request({ capacity: 1, goingCount: 1, currentStatus: "waitlist" })),
    ).toEqual({ outcome: "stored", status: "waitlist", changed: false });
  });

  it("is true on a first answer", () => {
    expect(deriveRequestedRsvp(request({ currentStatus: null }))).toMatchObject({ changed: true });
  });
});

describe("deriveDecidedRsvp — who and what may be decided", () => {
  it("approves a pending request into a seat", () => {
    expect(deriveDecidedRsvp(decision())).toEqual({
      outcome: "stored",
      status: "going",
      capacityOverride: false,
    });
  });

  it("waitlists an approval into a full event rather than silently exceeding the cap", () => {
    expect(deriveDecidedRsvp(decision({ capacity: 5, goingCount: 5 }))).toEqual({
      outcome: "stored",
      status: "waitlist",
      capacityOverride: false,
    });
  });

  it("admits past the cap when the host overrides, and records that it happened", () => {
    expect(deriveDecidedRsvp(decision({ capacity: 5, goingCount: 5, override: true }))).toEqual({
      outcome: "stored",
      status: "going",
      capacityOverride: true,
    });
  });

  it("does not record an override that overrode nothing", () => {
    expect(deriveDecidedRsvp(decision({ capacity: 5, goingCount: 1, override: true }))).toEqual({
      outcome: "stored",
      status: "going",
      capacityOverride: false,
    });
  });

  it("refuses to deny somebody who is already going — that would be an eject, not a refusal", () => {
    expect(deriveDecidedRsvp(decision({ decision: "deny", currentStatus: "going" }))).toEqual({
      outcome: "refused",
      reason: "not_decidable",
    });
  });

  it("refuses to approve somebody who is already going", () => {
    expect(deriveDecidedRsvp(decision({ currentStatus: "going" }))).toEqual({
      outcome: "refused",
      reason: "not_decidable",
    });
  });

  it("refuses to reinstate a denied row — the person has to ask again themselves", () => {
    expect(deriveDecidedRsvp(decision({ currentStatus: "denied" }))).toEqual({
      outcome: "refused",
      reason: "not_decidable",
    });
  });

  it("refuses to decide on a not_going row", () => {
    expect(deriveDecidedRsvp(decision({ currentStatus: "not_going" }))).toEqual({
      outcome: "refused",
      reason: "not_decidable",
    });
  });

  it("approves a waitlisted person once a seat exists", () => {
    expect(
      deriveDecidedRsvp(decision({ currentStatus: "waitlist", capacity: 5, goingCount: 2 })),
    ).toMatchObject({ status: "going" });
  });

  it("refuses to approve into a past event — an approval mints attendance", () => {
    expect(deriveDecidedRsvp(decision({ hasEnded: true }))).toEqual({
      outcome: "refused",
      reason: "event_ended",
    });
  });

  it("still allows a denial after the event ended — denying grants nothing", () => {
    expect(deriveDecidedRsvp(decision({ decision: "deny", hasEnded: true }))).toEqual({
      outcome: "stored",
      status: "denied",
      capacityOverride: false,
    });
  });

  it("does not let an override smuggle somebody past the not_decidable check", () => {
    expect(
      deriveDecidedRsvp(decision({ currentStatus: "going", override: true, capacity: 1, goingCount: 1 })),
    ).toEqual({ outcome: "refused", reason: "not_decidable" });
  });
});

describe("isFull / seatsRemaining", () => {
  it("treats null capacity as unlimited rather than as zero", () => {
    expect(isFull(null, 10_000)).toBe(false);
    expect(seatsRemaining(null, 10_000)).toBeNull();
  });

  it("never reports negative seats at an over-capacity event", () => {
    expect(seatsRemaining(5, 7)).toBe(0);
    expect(isFull(5, 7)).toBe(true);
  });
});

describe("the waitlist queue", () => {
  const entries: WaitlistEntry[] = [
    { rsvpId: "r3", userId: "carol", respondedAt: "2026-08-14T12:00:00.000Z" },
    { rsvpId: "r1", userId: "alice", respondedAt: "2026-08-14T09:00:00.000Z" },
    { rsvpId: "r2", userId: "bob", respondedAt: "2026-08-14T10:00:00.000Z" },
  ];

  it("orders oldest first, regardless of the order rows arrive in", () => {
    expect(waitlistOrder(entries).map((e) => e.userId)).toEqual(["alice", "bob", "carol"]);
  });

  it("does not mutate the input", () => {
    const copy = [...entries];
    waitlistOrder(entries);
    expect(entries).toEqual(copy);
  });

  it("breaks an identical-timestamp tie deterministically by rsvp id", () => {
    const tied: WaitlistEntry[] = [
      { rsvpId: "rB", userId: "second", respondedAt: "2026-08-14T09:00:00.000Z" },
      { rsvpId: "rA", userId: "first", respondedAt: "2026-08-14T09:00:00.000Z" },
    ];
    expect(waitlistOrder(tied).map((e) => e.userId)).toEqual(["first", "second"]);
    // Reversed input, same answer — this is the property that matters.
    expect(waitlistOrder([...tied].reverse()).map((e) => e.userId)).toEqual(["first", "second"]);
  });

  it("promotes the single oldest row when exactly one seat frees", () => {
    expect(nextWaitlistPromotions(entries, 1).map((e) => e.userId)).toEqual(["alice"]);
  });

  it("promotes several in order when several seats appear at once (a capacity raise)", () => {
    expect(nextWaitlistPromotions(entries, 2).map((e) => e.userId)).toEqual(["alice", "bob"]);
  });

  it("promotes everybody waiting when capacity is removed entirely", () => {
    expect(nextWaitlistPromotions(entries, null).map((e) => e.userId)).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
  });

  it("promotes nobody when no seat is free, including a negative count from an over-full event", () => {
    expect(nextWaitlistPromotions(entries, 0)).toEqual([]);
    expect(nextWaitlistPromotions(entries, -3)).toEqual([]);
  });

  it("never promotes more people than are waiting", () => {
    expect(nextWaitlistPromotions(entries, 99)).toHaveLength(3);
  });

  it("reports a 1-based position, and null for somebody who is not queued", () => {
    expect(waitlistPositionOf(entries, "alice")).toBe(1);
    expect(waitlistPositionOf(entries, "carol")).toBe(3);
    expect(waitlistPositionOf(entries, "dave")).toBeNull();
  });
});

describe("summarizeConnectionsAttending — Q21's two counts", () => {
  it("splits going and interested into separate buckets rather than one total", () => {
    const summary = summarizeConnectionsAttending([
      { user_id: "a", status: "going" },
      { user_id: "b", status: "interested" },
      { user_id: "c", status: "going" },
    ]);
    expect(summary).toEqual({ going: ["a", "c"], interested: ["b"] });
  });

  it("returns two empty buckets for an event none of your connections answered", () => {
    expect(summarizeConnectionsAttending([])).toEqual({ going: [], interested: [] });
  });

  it("drops any status the RPC should never have returned instead of guessing a bucket", () => {
    const summary = summarizeConnectionsAttending([
      { user_id: "a", status: "going" },
      { user_id: "b", status: "waitlist" },
      { user_id: "c", status: "pending" },
      { user_id: "d", status: "denied" },
      { user_id: "e", status: "not_going" },
    ]);
    expect(summary).toEqual({ going: ["a"], interested: [] });
  });
});
