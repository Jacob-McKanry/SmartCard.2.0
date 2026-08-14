/**
 * The one interface `packages/core` uses to reach the outside world.
 *
 * WHY A PORT INSTEAD OF IMPORTING `supabase-js` HERE
 * §1.3 keeps `packages/core` free of network, React and database access so it
 * can be unit-tested in isolation and imported unchanged by both a server and a
 * phone. That constraint is usually justified as portability; on this
 * particular code it buys something more valuable. The adversarial tests §4.7
 * demands — "a scan from outside the radius is rejected even with a perfectly
 * valid, current, correctly-signed token" — have to be able to construct
 * arbitrary, hostile world-states cheaply and deterministically: a consumed
 * session, a rotated nonce, a pair two kilometres apart, a block that appeared
 * mid-request. Against a real database each of those is a fixture; against a
 * fake implementing this interface each is three lines. The tests that get
 * written are the ones that are cheap to write.
 *
 * The production implementation lives in
 * `apps/web/src/server/connect/supabase-connect-store.ts` and is the ONLY thing
 * in the system that holds the service-role client for this flow.
 *
 * EVERY METHOD HERE IS A QUESTION OR A COMMAND, NEVER A DECISION.
 * There is deliberately no `canConnect()` or `isAllowed()` on this interface.
 * Authorization decisions live in the verifiers, in one place, where they can be
 * read in the order §4.2 step 5 specifies. A store that answered policy
 * questions would be a second place for that logic to live and a second place
 * for it to drift.
 */

import type { VerificationConfig } from "./config";
import type { RejectionReason } from "./rejection-reasons";
import type { RelaxationHistory } from "./relaxation";
import type { VerificationMethodId } from "@smartcard/types";

/** A `connection_sessions` row, as the verifier needs to see it. */
export interface SessionRecord {
  id: string;
  method: VerificationMethodId;
  presenterUserId: string;
  status: "active" | "consumed" | "expired" | "revoked";
  currentNonce: string | null;
  previousNonce: string | null;
  nonceIssuedAt: Date | null;
  presenterLatitude: number | null;
  presenterLongitude: number | null;
  presenterAccuracyM: number | null;
  presenterLocationAt: Date | null;
  deviceId: string | null;
  expiresAt: Date;
}

/** A `cards` row, as the NFC verifier needs to see it. */
export interface CardRecord {
  id: string;
  cardCode: string;
  status: "unassigned" | "assigned" | "revoked";
  ownerUserId: string | null;
}

/**
 * An event that COULD have hosted a meeting between two specific people — a
 * candidate, not an answer.
 *
 * `latitude`/`longitude` are non-nullable HERE even though the columns are
 * nullable in `events`. An event whose venue coordinates were never set cannot
 * be geofence-matched against anything, so the store drops it rather than
 * handing core a row with holes in it that core would then have to re-check.
 * That keeps the "can this even be a candidate?" question — a pure data
 * question — entirely on the store's side of the port, and leaves core with
 * only the decision.
 */
export interface CandidateEventRecord {
  id: string;
  latitude: number;
  longitude: number;
}

export interface AttemptLogRecord {
  sessionId: string | null;
  method: VerificationMethodId;
  scannerUserId: string | null;
  presenterUserId: string | null;
  outcome: "success" | "rejected";
  rejectionReason: RejectionReason | null;
  distanceM: number | null;
  scannerAccuracyM: number | null;
  presenterAccuracyM: number | null;
  radiusConfigUsedM: number | null;
  accuracyConfigUsedM: number | null;
  radiusMode: "normal" | "relaxed";
  relaxationSourceAttemptId: string | null;
  ipHash: string | null;
  userAgent: string | null;
}

export interface CommitInput {
  method: VerificationMethodId;
  presenterUserId: string;
  scannerUserId: string;
  /** Null on the NFC path — the database function creates the session row itself. */
  sessionId: string | null;
  occurredAt: Date;
  eventId: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  distanceM: number | null;
  scannerAccuracyM: number | null;
  presenterAccuracyM: number | null;
  radiusConfigUsedM: number | null;
  accuracyConfigUsedM: number | null;
  radiusMode: "normal" | "relaxed";
  relaxationSourceAttemptId: string | null;
  ipHash: string | null;
  userAgent: string | null;
}

export type CommitResult =
  | {
      ok: true;
      connectionId: string;
      meetingId: string;
      sessionId: string;
      attemptId: string | null;
      /** True when a previously-removed edge was re-activated by this fresh verification. */
      reconnected: boolean;
    }
  | { ok: false; reason: string };

export interface RateLimitRequest {
  action: string;
  subjectKind: "user" | "ip" | "card" | "session";
  subjectKey: string;
  limit: number;
  windowSeconds: number;
}

export interface ConnectStore {
  /** Reads and validates every `app_config` row the flow needs. Throws rather than defaulting. */
  loadConfig(): Promise<VerificationConfig>;

  createSession(input: {
    presenterUserId: string;
    method: VerificationMethodId;
    nonce: string;
    deviceId: string | null;
    expiresAt: Date;
    now: Date;
  }): Promise<SessionRecord>;

  loadSession(sessionId: string): Promise<SessionRecord | null>;

  /**
   * Writes a fresh presenter fix, and rotates the nonce when
   * `qr_rotation_seconds` has elapsed since the last rotation.
   *
   * One call rather than two, because the two are the same event: see the
   * heartbeat route for why token rotation is folded into the location
   * heartbeat rather than given an endpoint of its own. Returns null when the
   * session is not the caller's, or is not active — the caller turns that into
   * a refusal.
   */
  heartbeat(input: {
    sessionId: string;
    presenterUserId: string;
    latitude: number;
    longitude: number;
    accuracyM: number;
    capturedAt: Date;
    now: Date;
    rotationSeconds: number;
    nextNonce: string;
  }): Promise<SessionRecord | null>;

  areConnected(a: string, b: string): Promise<boolean>;
  isBlockedEitherWay(a: string, b: string): Promise<boolean>;

  findCardByCode(cardCode: string): Promise<CardRecord | null>;

  /** Counts rejections logged against one session — the input to §4.6's five-failures rule. */
  countSessionRejections(sessionId: string): Promise<number>;

  /** Sets a session to `revoked`. Used when the five-failure limit burns it. */
  burnSession(sessionId: string): Promise<void>;

  /** The one indexed query §4.3's "derived, not stored" judgment call rests on. */
  loadRelaxationHistory(input: {
    presenterUserId: string;
    scannerUserId: string;
    unlockingReasons: readonly RejectionReason[];
    windowSeconds: number;
    now: Date;
  }): Promise<RelaxationHistory>;

  /**
   * Which events could a meeting between these two people plausibly have
   * happened at? Used ONLY to fill `meetings.event_id` after a verification has
   * already been accepted (§2.6) — never as an input to accepting it.
   *
   * Returns candidates, not a decision, and the split is the point. The store
   * answers the parts that are pure data — both people answered `going` to it,
   * it was running at `now`, its venue coordinates are set — and core answers
   * the parts that are judgment: whether both GPS fixes actually fall inside
   * the event's geofence, and what to do when two events qualify at once
   * (nothing; see `event-tagging.ts`). That mirrors where the GPS gate's own
   * distance comparison lives, which is in core and not in SQL, for the reason
   * this file's header gives: a rule that can only be exercised against a
   * database is a rule that gets one test instead of ten.
   *
   * `windowHoursIfNoEnd` is how long an event with no `ends_at` is treated as
   * still running after `starts_at`. It comes from `app_config`, so the store
   * never invents it.
   */
  findCandidateEventsForConnection(input: {
    presenterUserId: string;
    scannerUserId: string;
    now: Date;
    windowHoursIfNoEnd: number;
  }): Promise<CandidateEventRecord[]>;

  /** Records the event and reports whether the subject is still inside its limit. */
  consumeRateLimit(request: RateLimitRequest): Promise<boolean>;

  /** Returns the new row's id, or null if logging itself failed (which must never abort a refusal). */
  logAttempt(record: AttemptLogRecord): Promise<string | null>;

  /** The atomic multi-table write. One RPC, one transaction. */
  commitVerifiedConnection(input: CommitInput): Promise<CommitResult>;
}
