/**
 * An in-memory `ConnectStore` for the adversarial tests.
 *
 * WHY A FAKE AND NOT THE REAL DATABASE
 * Two reasons, and the second is the one that matters.
 *
 *  1. This environment's egress policy blocks the project's Supabase host, the
 *     same restriction recorded against the §6.5 photo upload and the §6.6 RLS
 *     spot-check. A test suite that cannot run is not a test suite.
 *
 *  2. Much more importantly: the attacks in §4.7 are about world-states, and
 *     hostile world-states have to be cheap to build or they do not get built.
 *     "A session consumed one millisecond ago", "a nonce that rotated twice",
 *     "a scanner 2.1km away with a perfectly valid current token", "a block
 *     that appeared between the check and the write" are each two or three
 *     lines here. Against a real database each is a fixture, a cleanup, and a
 *     reason to write one test instead of ten.
 *
 * WHAT THIS FAKE IS AND IS NOT EVIDENCE FOR
 * It exercises the real verifiers, the real GPS gate, the real relaxation
 * logic, the real token code and the real `createVerifiedConnection` — every
 * line of the decision-making is production code. What it does NOT prove is
 * that Postgres enforces what it is supposed to: that RLS refuses a direct
 * client insert into `connections`, that the atomic function is atomic, that
 * the compare-and-swap is a compare-and-swap. Those are properties of the
 * database and were verified against the live database directly, by simulated
 * session, the same technique §6.6 used — see the Connect Flow notes in the
 * architecture doc. Neither kind of check substitutes for the other.
 *
 * THE COMMIT BEHAVIOUR BELOW DELIBERATELY MIRRORS THE SQL FUNCTION, including
 * its compare-and-swap on the session and its refusal when a pair is already
 * connected. A fake that always says yes would let a test pass while the thing
 * it is testing is broken.
 */

import type {
  AttemptLogRecord,
  CandidateEventRecord,
  CardRecord,
  CommitInput,
  CommitResult,
  ConnectStore,
  RateLimitRequest,
  SessionRecord,
} from "../ports";
import type { VerificationConfig } from "../config";
import type { RelaxationHistory } from "../relaxation";

export interface FakeAttemptRow extends AttemptLogRecord {
  id: string;
  createdAt: Date;
}

export interface FakeConnection {
  userA: string;
  userB: string;
  status: "active" | "removed";
  originMeetingId: string;
}

/**
 * An `events` row, with the two nullable fields that decide candidacy kept
 * nullable — an event with no `ends_at` and an event with no venue coordinates
 * are both cases the matching rule has to handle, so the fixture has to be able
 * to express them.
 */
export interface FakeEvent {
  id: string;
  startsAt: Date;
  endsAt: Date | null;
  latitude: number | null;
  longitude: number | null;
}

/** An `event_rsvps` row. The status set is the one 20260814051000 allows. */
export interface FakeEventRsvp {
  eventId: string;
  userId: string;
  status: "going" | "interested" | "not_going" | "waitlist" | "pending" | "denied";
}

/** The values seeded by the migrations, so tests run against the real thresholds. */
export const DEFAULT_CONFIG: VerificationConfig = {
  qr_max_distance_m: 150,
  qr_max_accuracy_m: 100,
  qr_token_ttl_seconds: 45,
  qr_rotation_seconds: 30,
  presenter_location_max_age_seconds: 90,
  session_max_lifetime_seconds: 300,

  qr_relaxation_enabled: true,
  qr_relaxation_failure_threshold: 2,
  qr_relaxation_window_seconds: 600,
  qr_relaxed_max_distance_m: 500,
  qr_relaxed_max_accuracy_m: 150,
  qr_relaxation_cooldown_seconds: 3600,

  nfc_tap_notification_coalesce_seconds: 300,

  event_geofence_radius_m: 150,
  event_auto_tag_default_window_hours: 4,

  rate_limit_qr_session_create_per_user_hour: 60,
  rate_limit_qr_redeem_per_user_hour: 60,
  rate_limit_qr_redeem_failures_per_session: 5,
  rate_limit_nfc_redeem_per_card_hour: 20,
  rate_limit_nfc_redeem_per_user_hour: 60,
  rate_limit_connect_per_ip_hour: 600,
};

let counter = 0;
/**
 * Ids are real, well-formed uuids — not readable strings.
 *
 * That matters: `qrTokenPayloadSchema` validates `sid` as a guid, and a fake
 * that handed out `"session-1"` would make every token in the suite fail
 * validation for a reason that has nothing to do with the attack being tested.
 * The leading block is a readable hex label so a failure message still says
 * what kind of id it was looking at.
 */
function nextId(hexLabel: string): string {
  counter += 1;
  const block = hexLabel
    .replace(/[^0-9a-f]/gi, "0")
    .padEnd(8, "0")
    .slice(0, 8);
  return `${block}-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}

export class FakeConnectStore implements ConnectStore {
  config: VerificationConfig = { ...DEFAULT_CONFIG };
  sessions = new Map<string, SessionRecord>();
  cards = new Map<string, CardRecord>();
  connections: FakeConnection[] = [];
  blocks: Array<{ blocker: string; blocked: string }> = [];
  attempts: FakeAttemptRow[] = [];
  events: FakeEvent[] = [];
  eventRsvps: FakeEventRsvp[] = [];
  rateLimitEvents: Array<{ key: string; at: Date }> = [];
  /** Set to a Date to make every time-dependent store method deterministic. */
  now: Date = new Date("2026-08-13T18:00:00.000Z");

  async loadConfig(): Promise<VerificationConfig> {
    return this.config;
  }

  async createSession(input: {
    presenterUserId: string;
    method: SessionRecord["method"];
    nonce: string;
    deviceId: string | null;
    expiresAt: Date;
    now: Date;
  }): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: nextId("5e551011"),
      method: input.method,
      presenterUserId: input.presenterUserId,
      status: "active",
      currentNonce: input.nonce,
      previousNonce: null,
      nonceIssuedAt: input.now,
      presenterLatitude: null,
      presenterLongitude: null,
      presenterAccuracyM: null,
      presenterLocationAt: null,
      deviceId: input.deviceId,
      expiresAt: input.expiresAt,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async loadSession(sessionId: string): Promise<SessionRecord | null> {
    const found = this.sessions.get(sessionId);
    return found === undefined ? null : { ...found };
  }

  async heartbeat(input: {
    sessionId: string;
    presenterUserId: string;
    latitude: number;
    longitude: number;
    accuracyM: number;
    capturedAt: Date;
    now: Date;
    rotationSeconds: number;
    nextNonce: string;
  }): Promise<SessionRecord | null> {
    const session = this.sessions.get(input.sessionId);
    if (
      session === undefined ||
      session.presenterUserId !== input.presenterUserId ||
      session.status !== "active"
    ) {
      return null;
    }

    session.presenterLatitude = input.latitude;
    session.presenterLongitude = input.longitude;
    session.presenterAccuracyM = input.accuracyM;
    session.presenterLocationAt = input.capturedAt;

    const rotationDue =
      session.nonceIssuedAt === null ||
      (input.now.getTime() - session.nonceIssuedAt.getTime()) / 1000 >= input.rotationSeconds;

    if (rotationDue) {
      session.previousNonce = session.currentNonce;
      session.currentNonce = input.nextNonce;
      session.nonceIssuedAt = input.now;
    }
    return { ...session };
  }

  async areConnected(a: string, b: string): Promise<boolean> {
    const [low, high] = a < b ? [a, b] : [b, a];
    return this.connections.some(
      (c) => c.userA === low && c.userB === high && c.status === "active",
    );
  }

  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    return this.blocks.some(
      (block) =>
        (block.blocker === a && block.blocked === b) ||
        (block.blocker === b && block.blocked === a),
    );
  }

  async findCardByCode(cardCode: string): Promise<CardRecord | null> {
    for (const card of this.cards.values()) {
      if (card.cardCode === cardCode) return { ...card };
    }
    return null;
  }

  async countSessionRejections(sessionId: string): Promise<number> {
    return this.attempts.filter((a) => a.sessionId === sessionId && a.outcome === "rejected")
      .length;
  }

  async burnSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session !== undefined && session.status === "active") {
      session.status = "revoked";
    }
  }

  async loadRelaxationHistory(input: {
    presenterUserId: string;
    scannerUserId: string;
    unlockingReasons: readonly string[];
    windowSeconds: number;
    now: Date;
  }): Promise<RelaxationHistory> {
    const since = input.now.getTime() - input.windowSeconds * 1000;

    const failures = this.attempts
      .filter(
        (a) =>
          a.presenterUserId === input.presenterUserId &&
          a.scannerUserId === input.scannerUserId &&
          a.outcome === "rejected" &&
          a.rejectionReason !== null &&
          input.unlockingReasons.includes(a.rejectionReason) &&
          a.createdAt.getTime() >= since,
      )
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());

    const lastRelaxed = this.attempts
      .filter(
        (a) =>
          a.presenterUserId === input.presenterUserId &&
          a.scannerUserId === input.scannerUserId &&
          a.radiusMode === "relaxed",
      )
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0];

    return {
      unlockingFailuresInWindow: failures.length,
      mostRecentUnlockingFailureId: failures[0]?.id ?? null,
      lastRelaxedAttemptAt: lastRelaxed?.createdAt ?? null,
    };
  }

  /**
   * Mirrors the candidate query in `supabase-connect-store.ts`, including what
   * it deliberately does NOT do: no distance comparison and no tie-break. A
   * fake that returned "the answer" instead of the candidates would make the
   * geofence and ambiguity tests pass without exercising the rule that decides
   * them.
   */
  async findCandidateEventsForConnection(input: {
    presenterUserId: string;
    scannerUserId: string;
    now: Date;
    windowHoursIfNoEnd: number;
  }): Promise<CandidateEventRecord[]> {
    const goingTo = (userId: string) =>
      new Set(
        this.eventRsvps
          .filter((rsvp) => rsvp.userId === userId && rsvp.status === "going")
          .map((rsvp) => rsvp.eventId),
      );

    const presenterGoing = goingTo(input.presenterUserId);
    const scannerGoing = goingTo(input.scannerUserId);
    const nowMs = input.now.getTime();

    return this.events
      .filter((event) => presenterGoing.has(event.id) && scannerGoing.has(event.id))
      .filter((event) => {
        if (event.startsAt.getTime() > nowMs) return false;
        const endMs =
          event.endsAt === null
            ? event.startsAt.getTime() + input.windowHoursIfNoEnd * 3_600_000
            : event.endsAt.getTime();
        return nowMs <= endMs;
      })
      .filter(
        (event): event is FakeEvent & { latitude: number; longitude: number } =>
          event.latitude !== null && event.longitude !== null,
      )
      .map((event) => ({ id: event.id, latitude: event.latitude, longitude: event.longitude }));
  }

  /** Mirrors `rate_limit_consume`: record first, then count, so it errs toward refusing. */
  async consumeRateLimit(request: RateLimitRequest): Promise<boolean> {
    const key = `${request.action}:${request.subjectKind}:${request.subjectKey}`;
    this.rateLimitEvents.push({ key, at: this.now });
    const since = this.now.getTime() - request.windowSeconds * 1000;
    const count = this.rateLimitEvents.filter(
      (e) => e.key === key && e.at.getTime() > since,
    ).length;
    return count <= request.limit;
  }

  async logAttempt(record: AttemptLogRecord): Promise<string | null> {
    const row: FakeAttemptRow = { ...record, id: nextId("a77e3170"), createdAt: this.now };
    this.attempts.push(row);
    return row.id;
  }

  /**
   * Mirrors `public.create_verified_connection`, including the parts that
   * refuse. The compare-and-swap on the session is what makes a replay test
   * meaningful: if this simply wrote a row, "the second scan is rejected" would
   * pass for the wrong reason.
   */
  async commitVerifiedConnection(input: CommitInput): Promise<CommitResult> {
    if (input.presenterUserId === input.scannerUserId) {
      return { ok: false, reason: "self_connect" };
    }
    if (await this.isBlockedEitherWay(input.presenterUserId, input.scannerUserId)) {
      return { ok: false, reason: "blocked" };
    }

    const [low, high] =
      input.presenterUserId < input.scannerUserId
        ? [input.presenterUserId, input.scannerUserId]
        : [input.scannerUserId, input.presenterUserId];

    const existing = this.connections.find((c) => c.userA === low && c.userB === high);
    if (existing !== undefined && existing.status === "active") {
      return { ok: false, reason: "already_connected" };
    }

    let sessionId = input.sessionId;
    if (sessionId !== null) {
      const session = this.sessions.get(sessionId);
      const consumable =
        session !== undefined &&
        session.status === "active" &&
        session.expiresAt.getTime() > this.now.getTime() &&
        session.presenterUserId === input.presenterUserId &&
        session.method === input.method;

      if (!consumable) {
        return { ok: false, reason: "session_not_consumable" };
      }
      session.status = "consumed";
    } else {
      if (input.method !== "nfc_card") {
        return { ok: false, reason: "missing_session" };
      }
      const created = await this.createSession({
        presenterUserId: input.presenterUserId,
        method: "nfc_card",
        nonce: "",
        deviceId: null,
        expiresAt: this.now,
        now: this.now,
      });
      created.status = "consumed";
      sessionId = created.id;
    }

    const meetingId = nextId("3ee71065");
    let reconnected = false;
    if (existing === undefined) {
      this.connections.push({
        userA: low,
        userB: high,
        status: "active",
        originMeetingId: meetingId,
      });
    } else {
      existing.status = "active";
      existing.originMeetingId = meetingId;
      reconnected = true;
    }

    const attemptId = await this.logAttempt({
      sessionId,
      method: input.method,
      scannerUserId: input.scannerUserId,
      presenterUserId: input.presenterUserId,
      outcome: "success",
      rejectionReason: null,
      distanceM: input.distanceM,
      scannerAccuracyM: input.scannerAccuracyM,
      presenterAccuracyM: input.presenterAccuracyM,
      radiusConfigUsedM: input.radiusConfigUsedM,
      accuracyConfigUsedM: input.accuracyConfigUsedM,
      radiusMode: input.radiusMode,
      relaxationSourceAttemptId: input.relaxationSourceAttemptId,
      ipHash: input.ipHash,
      userAgent: input.userAgent,
    });

    return {
      ok: true,
      connectionId: nextId("c0nnec71"),
      meetingId,
      sessionId,
      attemptId,
      reconnected,
    };
  }
}
