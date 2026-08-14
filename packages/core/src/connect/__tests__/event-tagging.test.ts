import { beforeEach, describe, expect, it } from "vitest";

import { createNfcVerifier } from "../nfc-verifier";
import { createQrVerifier } from "../qr-verifier";
import { createVerifiedConnection } from "../create-verified-connection";
import type { CommitInput } from "../ports";
import { generateNonce, signQrToken } from "../qr-token";
import type { QrRedeemRequest } from "@smartcard/types";
import type { RequestContext, VerificationOutcome } from "../verification";
import { DEFAULT_CONFIG, FakeConnectStore, type FakeEvent } from "./fake-store";

/**
 * Automatic event tagging (§2.6), end to end through the real QR verifier.
 *
 * THIS FILE HAS TWO HALVES AND THE SECOND IS THE IMPORTANT ONE.
 *
 * The first half checks the matching rule against the store: both people
 * `going`, the time window, the venue coordinates, the geofence, and the
 * decision to decline rather than guess when two events qualify at once.
 *
 * The second half — "event tagging cannot influence the verification" — is the
 * one that would matter if this feature were ever wrong. `qr-verifier.ts` is
 * the connection-security gate, and this change added a tenth step to a
 * function whose step ORDER is itself a security property. The claim being made
 * is that the step is inert: the same scan is accepted or refused for the same
 * reason whether the event world is empty, holds a perfectly matching event, or
 * is a database that throws on contact. That claim is asserted here across
 * every rejection the QR path can produce, rather than argued in a comment.
 */

const SECRET = "event-tagging-test-secret";
const NOW = new Date("2026-08-13T18:00:00.000Z");

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // presenter
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // scanner, standing next to Alice
const MALLORY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // remote attacker

/** Midtown Manhattan. Alice is here, and so is the venue. */
const HERE = { latitude: 40.758, longitude: -73.9855 };
/** ~55 m away — same block. Bob scans from here. */
const NEXT_TO_HER = { latitude: 40.75845, longitude: -73.98577 };
/** ~2.1 km away — same city, different building. */
const ACROSS_TOWN = { latitude: 40.7391, longitude: -73.9903 };

const EVENT_ONE = "e0000001-0000-4000-8000-000000000001";
const EVENT_TWO = "e0000002-0000-4000-8000-000000000002";

const FOUR_HOURS_MS = DEFAULT_CONFIG.event_auto_tag_default_window_hours * 3_600_000;

function ctx(userId: string, now: Date = NOW): RequestContext {
  return { callerUserId: userId, ipHash: "hashed-ip", userAgent: "vitest", now };
}

function scannerLocation(
  point: { latitude: number; longitude: number },
  over: { accuracyM?: number; capturedAt?: Date } = {},
) {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyM: over.accuracyM ?? 10,
    capturedAt: (over.capturedAt ?? NOW).toISOString(),
  };
}

/** A live session for Alice with a fresh heartbeat, plus a token minted from it. */
async function livePresenterSession(store: FakeConnectStore, at = HERE, when = NOW) {
  const session = await store.createSession({
    presenterUserId: ALICE,
    method: "qr_gps",
    nonce: generateNonce(),
    deviceId: "alice-phone",
    expiresAt: new Date(when.getTime() + DEFAULT_CONFIG.session_max_lifetime_seconds * 1000),
    now: when,
  });
  await store.heartbeat({
    sessionId: session.id,
    presenterUserId: ALICE,
    latitude: at.latitude,
    longitude: at.longitude,
    accuracyM: 10,
    capturedAt: when,
    now: when,
    rotationSeconds: DEFAULT_CONFIG.qr_rotation_seconds,
    nextNonce: generateNonce(),
  });
  const current = (await store.loadSession(session.id))!;
  const iat = Math.floor(when.getTime() / 1000);
  const token = await signQrToken(SECRET, {
    sid: current.id,
    nonce: current.currentNonce!,
    iat,
    exp: iat + DEFAULT_CONFIG.qr_token_ttl_seconds,
  });
  return { session: current, token };
}

function qr(store: FakeConnectStore) {
  return createQrVerifier({ store, signingSecret: SECRET, config: store.config });
}

/** An event running right now at the venue Alice and Bob are standing at. */
function eventAtTheVenue(over: Partial<FakeEvent> = {}): FakeEvent {
  return {
    id: EVENT_ONE,
    startsAt: new Date(NOW.getTime() - 60 * 60_000),
    endsAt: new Date(NOW.getTime() + 60 * 60_000),
    latitude: HERE.latitude,
    longitude: HERE.longitude,
    ...over,
  };
}

/** Puts an event in the world and RSVPs the named people to it. */
function stage(
  store: FakeConnectStore,
  event: FakeEvent,
  going: Array<[string, "going" | "interested" | "not_going" | "waitlist" | "pending" | "denied"]>,
) {
  store.events.push(event);
  for (const [userId, status] of going) {
    store.eventRsvps.push({ eventId: event.id, userId, status });
  }
}

/** Runs the honest scan — Bob, next to Alice, current token — and returns its outcome. */
async function honestScan(store: FakeConnectStore, now: Date = NOW) {
  const { token } = await livePresenterSession(store, HERE, now);
  return qr(store).verify(ctx(BOB, now), {
    token,
    scannerLocation: scannerLocation(NEXT_TO_HER, { capturedAt: now }),
  });
}

/** The tagged event id from an outcome that must have been accepted. */
function taggedEventId(outcome: VerificationOutcome): string | null {
  expect(outcome.ok, "expected this scan to be ACCEPTED, but it was refused").toBe(true);
  return outcome.ok ? ((outcome.evidence.eventId as string | null) ?? null) : null;
}

let store: FakeConnectStore;

beforeEach(() => {
  store = new FakeConnectStore();
  store.now = NOW;
});

// ---------------------------------------------------------------------------
// Rule 1 — BOTH people must have answered `going`.
// ---------------------------------------------------------------------------
describe("§2.6 rule 1 — both people answered `going`", () => {
  it("tags the meeting when both are going and both are at the venue (the control)", async () => {
    stage(store, eventAtTheVenue(), [
      [ALICE, "going"],
      [BOB, "going"],
    ]);
    expect(taggedEventId(await honestScan(store))).toBe(EVENT_ONE);
  });

  it("does not tag when only the presenter is going", async () => {
    stage(store, eventAtTheVenue(), [[ALICE, "going"]]);
    expect(taggedEventId(await honestScan(store))).toBeNull();
  });

  it("does not tag when only the scanner is going", async () => {
    stage(store, eventAtTheVenue(), [[BOB, "going"]]);
    expect(taggedEventId(await honestScan(store))).toBeNull();
  });

  it("does not tag when nobody has RSVP'd at all", async () => {
    stage(store, eventAtTheVenue(), []);
    expect(taggedEventId(await honestScan(store))).toBeNull();
  });

  it.each(["interested", "waitlist", "pending", "not_going", "denied"] as const)(
    "does not tag when the scanner's answer is `%s` rather than going",
    async (status) => {
      // `going` is the same line `private.shares_event_with()` draws, and for
      // the same reason: being interested in an event is not being at it. A
      // `pending` request the host has not approved is not attendance either.
      stage(store, eventAtTheVenue(), [
        [ALICE, "going"],
        [BOB, status],
      ]);
      expect(taggedEventId(await honestScan(store))).toBeNull();
    },
  );

  it("does not borrow a third party's RSVP", async () => {
    stage(store, eventAtTheVenue(), [
      [ALICE, "going"],
      [MALLORY, "going"],
    ]);
    expect(taggedEventId(await honestScan(store))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — the event has to have been running.
// ---------------------------------------------------------------------------
describe("§2.6 rule 2 — the time window", () => {
  const both: Array<[string, "going"]> = [
    [ALICE, "going"],
    [BOB, "going"],
  ];

  it("tags inside an explicit start/end window", async () => {
    stage(store, eventAtTheVenue(), both);
    expect(taggedEventId(await honestScan(store))).toBe(EVENT_ONE);
  });

  it("does not tag before the event has started", async () => {
    stage(
      store,
      eventAtTheVenue({
        startsAt: new Date(NOW.getTime() + 60_000),
        endsAt: new Date(NOW.getTime() + 3_600_000),
      }),
      both,
    );
    expect(taggedEventId(await honestScan(store))).toBeNull();
  });

  it("does not tag after an explicit ends_at has passed", async () => {
    stage(
      store,
      eventAtTheVenue({
        startsAt: new Date(NOW.getTime() - 7_200_000),
        endsAt: new Date(NOW.getTime() - 1_000),
      }),
      both,
    );
    expect(taggedEventId(await honestScan(store))).toBeNull();
  });

  it("tags inside the default window when ends_at is null", async () => {
    // The common case: `events.ends_at` is nullable and most hosts will not set
    // it. Without the default window such an event would stop matching the
    // instant it began.
    stage(
      store,
      eventAtTheVenue({ startsAt: new Date(NOW.getTime() - FOUR_HOURS_MS + 60_000), endsAt: null }),
      both,
    );
    expect(taggedEventId(await honestScan(store))).toBe(EVENT_ONE);
  });

  it("tags at exactly the default window's edge and declines a second past it", async () => {
    // `endsAt: null` in both halves is the whole point — the default window
    // only applies to an event that never declared an end.
    const atEdge = new FakeConnectStore();
    atEdge.now = NOW;
    stage(
      atEdge,
      eventAtTheVenue({ startsAt: new Date(NOW.getTime() - FOUR_HOURS_MS), endsAt: null }),
      both,
    );
    expect(taggedEventId(await honestScan(atEdge))).toBe(EVENT_ONE);

    const pastEdge = new FakeConnectStore();
    pastEdge.now = NOW;
    stage(
      pastEdge,
      eventAtTheVenue({ startsAt: new Date(NOW.getTime() - FOUR_HOURS_MS - 1_000), endsAt: null }),
      both,
    );
    expect(taggedEventId(await honestScan(pastEdge))).toBeNull();
  });

  it("respects a long explicit ends_at rather than the four-hour default", async () => {
    // A three-day festival. The default window exists only for events with NO
    // end; it must not cap events that declared one.
    stage(
      store,
      eventAtTheVenue({
        startsAt: new Date(NOW.getTime() - 48 * 3_600_000),
        endsAt: new Date(NOW.getTime() + 24 * 3_600_000),
      }),
      both,
    );
    expect(taggedEventId(await honestScan(store))).toBe(EVENT_ONE);
  });
});

// ---------------------------------------------------------------------------
// Rules 3 and 4 — venue coordinates, and the geofence around them.
// ---------------------------------------------------------------------------
describe("§2.6 rules 3 and 4 — the venue and its geofence", () => {
  const both: Array<[string, "going"]> = [
    [ALICE, "going"],
    [BOB, "going"],
  ];

  it("does not tag, and does not error, when the event has no venue coordinates", async () => {
    // §2.6 lets an event be created before its venue is confirmed. Such an
    // event can never geofence-match; it is skipped as a candidate rather than
    // treated as a broken row.
    stage(store, eventAtTheVenue({ latitude: null, longitude: null }), both);
    const outcome = await honestScan(store);
    expect(outcome.ok).toBe(true);
    expect(taggedEventId(outcome)).toBeNull();
  });

  it("does not tag when the event's venue is across town from both of them", async () => {
    stage(
      store,
      eventAtTheVenue({ latitude: ACROSS_TOWN.latitude, longitude: ACROSS_TOWN.longitude }),
      both,
    );
    expect(taggedEventId(await honestScan(store))).toBeNull();
  });

  it("does not tag when only one of the two is inside the geofence", async () => {
    // Alice is at the venue; Bob scans from ~350 m up the road — outside the
    // 150 m geofence, but inside nothing else changes, so the connection is
    // still made. It is the EVENT claim that is declined, not the meeting.
    const { token } = await livePresenterSession(store, HERE);
    stage(store, eventAtTheVenue(), both);
    store.config = { ...DEFAULT_CONFIG, qr_max_distance_m: 500 };

    const outcome = await createQrVerifier({
      store,
      signingSecret: SECRET,
      config: store.config,
    }).verify(ctx(BOB), {
      token,
      scannerLocation: scannerLocation({ latitude: 40.7601, longitude: -73.9885 }),
    });

    expect(outcome.ok).toBe(true);
    expect(taggedEventId(outcome)).toBeNull();
  });

  it("uses the configured geofence radius, so widening it changes the answer", async () => {
    const wide = new FakeConnectStore();
    wide.now = NOW;
    wide.config = { ...DEFAULT_CONFIG, qr_max_distance_m: 500, event_geofence_radius_m: 1000 };
    const { token } = await livePresenterSession(wide, HERE);
    stage(wide, eventAtTheVenue(), both);

    const outcome = await createQrVerifier({
      store: wide,
      signingSecret: SECRET,
      config: wide.config,
    }).verify(ctx(BOB), {
      token,
      scannerLocation: scannerLocation({ latitude: 40.7601, longitude: -73.9885 }),
    });

    expect(taggedEventId(outcome)).toBe(EVENT_ONE);
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — ambiguity declines.
// ---------------------------------------------------------------------------
describe("§2.6 rule 5 — two matching events leave the meeting untagged", () => {
  const both: Array<[string, "going"]> = [
    [ALICE, "going"],
    [BOB, "going"],
  ];

  it("does not guess between two concurrent events at the same venue", async () => {
    // Two parallel tracks in one building, both people going to both. Every
    // available tie-break is a guess, and a wrong tag is a durable, visible,
    // wrong claim about where somebody was.
    stage(store, eventAtTheVenue(), both);
    stage(store, eventAtTheVenue({ id: EVENT_TWO }), both);
    expect(taggedEventId(await honestScan(store))).toBeNull();
  });

  it("still tags when the second event is one they were not both going to", async () => {
    stage(store, eventAtTheVenue(), both);
    stage(store, eventAtTheVenue({ id: EVENT_TWO }), [[ALICE, "going"]]);
    expect(taggedEventId(await honestScan(store))).toBe(EVENT_ONE);
  });

  it("still tags when the second event is at a different venue", async () => {
    stage(store, eventAtTheVenue(), both);
    stage(
      store,
      eventAtTheVenue({
        id: EVENT_TWO,
        latitude: ACROSS_TOWN.latitude,
        longitude: ACROSS_TOWN.longitude,
      }),
      both,
    );
    expect(taggedEventId(await honestScan(store))).toBe(EVENT_ONE);
  });

  it("still tags when the second event had already finished", async () => {
    stage(store, eventAtTheVenue(), both);
    stage(
      store,
      eventAtTheVenue({
        id: EVENT_TWO,
        startsAt: new Date(NOW.getTime() - 7_200_000),
        endsAt: new Date(NOW.getTime() - 3_600_000),
      }),
      both,
    );
    expect(taggedEventId(await honestScan(store))).toBe(EVENT_ONE);
  });
});

// ---------------------------------------------------------------------------
// THE PROPERTY THAT MUST HOLD: tagging is inert with respect to the decision.
// ---------------------------------------------------------------------------
describe("event tagging cannot affect whether a connection is accepted or why it was refused", () => {
  /**
   * Every refusal the QR path can produce, as a world plus the request that
   * triggers it. Each is replayed against three different event worlds below.
   */
  const SCENARIOS: Array<{
    reason: string;
    build: (s: FakeConnectStore) => Promise<{ ctx: RequestContext; input: QrRedeemRequest }>;
  }> = [
    {
      reason: "too_far",
      build: async (s) => {
        const { token } = await livePresenterSession(s);
        return {
          ctx: ctx(MALLORY),
          input: { token, scannerLocation: scannerLocation(ACROSS_TOWN) },
        };
      },
    },
    {
      reason: "scanner_accuracy_too_low",
      build: async (s) => {
        const { token } = await livePresenterSession(s);
        return {
          ctx: ctx(MALLORY),
          input: { token, scannerLocation: scannerLocation(NEXT_TO_HER, { accuracyM: 5000 }) },
        };
      },
    },
    {
      reason: "scanner_location_stale",
      build: async (s) => {
        const { token } = await livePresenterSession(s);
        return {
          ctx: ctx(BOB),
          input: {
            token,
            scannerLocation: scannerLocation(NEXT_TO_HER, {
              capturedAt: new Date(NOW.getTime() - 600_000),
            }),
          },
        };
      },
    },
    {
      reason: "presenter_location_missing",
      build: async (s) => {
        // A session with no heartbeat ever posted.
        const session = await s.createSession({
          presenterUserId: ALICE,
          method: "qr_gps",
          nonce: generateNonce(),
          deviceId: null,
          expiresAt: new Date(NOW.getTime() + 300_000),
          now: NOW,
        });
        const iat = Math.floor(NOW.getTime() / 1000);
        const token = await signQrToken(SECRET, {
          sid: session.id,
          nonce: session.currentNonce!,
          iat,
          exp: iat + 45,
        });
        return { ctx: ctx(BOB), input: { token, scannerLocation: scannerLocation(NEXT_TO_HER) } };
      },
    },
    {
      reason: "self_connect",
      build: async (s) => {
        const { token } = await livePresenterSession(s);
        return { ctx: ctx(ALICE), input: { token, scannerLocation: scannerLocation(HERE) } };
      },
    },
    {
      reason: "blocked",
      build: async (s) => {
        s.blocks.push({ blocker: ALICE, blocked: BOB });
        const { token } = await livePresenterSession(s);
        return { ctx: ctx(BOB), input: { token, scannerLocation: scannerLocation(NEXT_TO_HER) } };
      },
    },
    {
      reason: "already_connected",
      build: async (s) => {
        s.connections.push({
          userA: ALICE < BOB ? ALICE : BOB,
          userB: ALICE < BOB ? BOB : ALICE,
          status: "active",
          originMeetingId: "m1",
        });
        const { token } = await livePresenterSession(s);
        return { ctx: ctx(BOB), input: { token, scannerLocation: scannerLocation(NEXT_TO_HER) } };
      },
    },
    {
      reason: "session_expired",
      build: async (s) => {
        const { session, token } = await livePresenterSession(s);
        session.expiresAt = new Date(NOW.getTime() - 1_000);
        s.sessions.set(session.id, session);
        return { ctx: ctx(BOB), input: { token, scannerLocation: scannerLocation(NEXT_TO_HER) } };
      },
    },
    {
      reason: "session_not_found",
      build: async (s) => {
        const { session, token } = await livePresenterSession(s);
        await s.burnSession(session.id);
        return { ctx: ctx(BOB), input: { token, scannerLocation: scannerLocation(NEXT_TO_HER) } };
      },
    },
    {
      reason: "token_expired",
      build: async (s) => {
        const { token } = await livePresenterSession(s);
        const later = new Date(NOW.getTime() + 46_000);
        return {
          ctx: ctx(BOB, later),
          input: { token, scannerLocation: scannerLocation(NEXT_TO_HER, { capturedAt: later }) },
        };
      },
    },
    {
      reason: "malformed_token",
      build: async () => ({
        ctx: ctx(MALLORY),
        input: {
          token: "'; drop table connections; --",
          scannerLocation: scannerLocation(NEXT_TO_HER),
        },
      }),
    },
    {
      reason: "rate_limited",
      build: async (s) => {
        // Budget spent by an earlier accepted scan, so the refusal happens at
        // step 9 — the LAST check before the tagging step, and therefore the
        // one with the least room between it and the code under suspicion.
        s.config = { ...DEFAULT_CONFIG, rate_limit_qr_redeem_per_user_hour: 1 };
        const first = await livePresenterSession(s);
        await createQrVerifier({ store: s, signingSecret: SECRET, config: s.config }).verify(
          ctx(BOB),
          { token: first.token, scannerLocation: scannerLocation(NEXT_TO_HER) },
        );
        const second = await livePresenterSession(s);
        return {
          ctx: ctx(BOB),
          input: { token: second.token, scannerLocation: scannerLocation(NEXT_TO_HER) },
        };
      },
    },
  ];

  /** The three event worlds a refusal must be identical across. */
  const WORLDS = {
    /** No events exist at all. A fresh `FakeConnectStore` is already this. */
    empty: () => {},
    /** An event that WOULD match a successful scan by this pair, right here, right now. */
    matching: (s: FakeConnectStore) => {
      stage(s, eventAtTheVenue(), [
        [ALICE, "going"],
        [BOB, "going"],
        [MALLORY, "going"],
      ]);
    },
    /** The events tables are on fire. Any read throws. */
    broken: (s: FakeConnectStore) => {
      s.findCandidateEventsForConnection = async () => {
        throw new Error("events query exploded");
      };
    },
  } as const;

  it.each(SCENARIOS)(
    "refuses with `$reason` identically in all three event worlds",
    async (scenario) => {
      const reasons: Record<string, string> = {};
      let lookupsDuringRefusal = 0;

      for (const [worldName, applyWorld] of Object.entries(WORLDS)) {
        const s = new FakeConnectStore();
        s.now = NOW;
        applyWorld(s);

        // Count every candidate lookup, whatever the world does with it.
        const inner = s.findCandidateEventsForConnection.bind(s);
        s.findCandidateEventsForConnection = async (arg) => {
          lookupsDuringRefusal += 1;
          return inner(arg);
        };

        const { ctx: requestCtx, input } = await scenario.build(s);
        const outcome = await createQrVerifier({
          store: s,
          signingSecret: SECRET,
          config: s.config,
        }).verify(requestCtx, input);

        expect(outcome.ok, `${worldName}: expected a refusal, got an acceptance`).toBe(false);
        reasons[worldName] = outcome.ok ? "" : outcome.reason;
      }

      // 1. The reason is the one this scenario is supposed to produce...
      expect(reasons.empty).toBe(scenario.reason);
      // 2. ...and it is the SAME reason whether a matching event exists or the
      //    events tables throw on contact.
      expect(reasons.matching).toBe(reasons.empty);
      expect(reasons.broken).toBe(reasons.empty);
      // 3. And the strongest form of the claim: on a refusal the event lookup was
      //    never reached at all, in any world. It cannot have contributed to a
      //    decision it was not consulted for. (The `rate_limited` scenario runs
      //    one accepted scan first to spend the budget; that acceptance is
      //    allowed exactly one lookup.)
      expect(lookupsDuringRefusal).toBe(scenario.reason === "rate_limited" ? 3 : 0);
    },
  );

  it("still accepts, and still connects, when the event lookup throws", async () => {
    // The fail-safe direction, and the one place this file deliberately departs
    // from CLAUDE.md's fail-closed default: a metadata lookup must never cost
    // somebody a connection they physically earned by standing next to
    // somebody. "Could not determine" and "there was no event" are the same
    // answer on purpose.
    let sawError: unknown = null;
    store.findCandidateEventsForConnection = async () => {
      throw new Error("events query exploded");
    };
    const { token } = await livePresenterSession(store);

    const outcome = await createQrVerifier({
      store,
      signingSecret: SECRET,
      config: store.config,
      onEventTaggingError: (error) => {
        sawError = error;
      },
    }).verify(ctx(BOB), { token, scannerLocation: scannerLocation(NEXT_TO_HER) });

    expect(outcome.ok).toBe(true);
    expect(taggedEventId(outcome)).toBeNull();
    // The failure is reported rather than swallowed silently — an untagged
    // meeting caused by a broken query should be distinguishable in a log from
    // one that simply happened nowhere.
    expect(sawError).toBeInstanceOf(Error);

    const created = await createVerifiedConnection(
      store,
      outcome as Extract<VerificationOutcome, { ok: true }>,
    );
    expect(created.connectionId).toBeTruthy();
    expect(store.connections).toHaveLength(1);
  });

  it("does not consult the event lookup when the scan is refused, even with a perfect match staged", async () => {
    // The same claim as the matrix above, written once in the most direct form
    // a reader can check at a glance.
    stage(store, eventAtTheVenue(), [
      [ALICE, "going"],
      [MALLORY, "going"],
    ]);
    let lookups = 0;
    store.findCandidateEventsForConnection = async () => {
      lookups += 1;
      return [];
    };

    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(MALLORY), {
      token,
      scannerLocation: scannerLocation(ACROSS_TOWN),
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? null : outcome.reason).toBe("too_far");
    expect(lookups).toBe(0);
  });

  it("leaves a refusal's evidence eventId null, so no rejection row can claim an event", async () => {
    stage(store, eventAtTheVenue(), [
      [ALICE, "going"],
      [MALLORY, "going"],
    ]);
    const { token } = await livePresenterSession(store);
    const outcome = await qr(store).verify(ctx(MALLORY), {
      token,
      scannerLocation: scannerLocation(ACROSS_TOWN),
    });
    expect(outcome.ok ? "accepted" : outcome.evidence.eventId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The tag actually reaches the write, and the NFC path is untouched.
// ---------------------------------------------------------------------------
describe("what happens to the tag afterwards", () => {
  it("carries the event id into the atomic commit as p_event_id", async () => {
    stage(store, eventAtTheVenue(), [
      [ALICE, "going"],
      [BOB, "going"],
    ]);
    const outcome = await honestScan(store);

    let committed: CommitInput | null = null;
    const inner = store.commitVerifiedConnection.bind(store);
    store.commitVerifiedConnection = async (input) => {
      committed = input;
      return inner(input);
    };

    await createVerifiedConnection(store, outcome as Extract<VerificationOutcome, { ok: true }>);
    expect(committed).not.toBeNull();
    expect(committed!.eventId).toBe(EVENT_ONE);
  });

  it("leaves an NFC tap untagged even when a matching event exists — a deliberate product decision", async () => {
    // NFC card taps have NO GPS gate at all: no location is captured on that
    // path and none may be (see `nfc-verifier.ts`). With no fix for either
    // party there is nothing to compare against a venue, and this pass does not
    // build a manual fallback. `nfc-verifier.ts` was not touched by this change.
    const CARD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    store.cards.set(CARD_ID, {
      id: CARD_ID,
      cardCode: "CUSTOM-f2a930bcb5fe",
      status: "assigned",
      ownerUserId: ALICE,
    });
    stage(store, eventAtTheVenue(), [
      [ALICE, "going"],
      [BOB, "going"],
    ]);

    const outcome = await createNfcVerifier({ store, config: store.config }).verify(ctx(BOB), {
      code: "CUSTOM-f2a930bcb5fe",
    });

    expect(outcome.ok).toBe(true);
    expect(taggedEventId(outcome)).toBeNull();
  });
});
