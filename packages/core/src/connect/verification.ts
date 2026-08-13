/**
 * The verification abstraction from architecture §4.1, and the type-level
 * guarantee that goes with it.
 *
 * WHAT §4.1 IS ACTUALLY ASKING FOR, AND WHY IT IS NOT DECORATION
 *
 * The rule is: "`createVerifiedConnection` accepts only a successful outcome
 * *produced by a verifier* — no API handler assembles a connection itself,
 * making 'connect these two users because the client asked me to'
 * unrepresentable in the type system."
 *
 * A plain `{ ok: true, ... }` object type does not deliver that. Any handler
 * could write that literal and hand it to the writer, and TypeScript would be
 * satisfied. So `VerifiedOutcome` below carries a brand — a property whose key
 * is a `unique symbol` that is not exported from this package. The only way to
 * obtain a value of that type is `sealVerified()`, which lives in
 * `./internal/seal` and is deliberately NOT re-exported from the package index;
 * `packages/core/package.json` declares `"exports": { ".": ... }` so a consumer
 * cannot deep-import it either. Inside this package, exactly two call sites use
 * it: the QR verifier and the NFC verifier.
 *
 * The practical effect: `createVerifiedConnection(store, outcome)` is
 * uncallable from `apps/web` with anything the route handler made up. It has to
 * be the literal return value of a verifier's `verify()`. That is what turns
 * §4.7 threat 4's "never add a second path that writes connections" from an
 * instruction into a compile error.
 */

import type { VerificationMethodId } from "@smartcard/types";

import type { RejectionReason } from "./rejection-reasons";

/**
 * A single GPS reading as reported by one device.
 *
 * `capturedAt` is when the *device took the fix*, not when the server received
 * it. Freshness is judged from the former, because the latter can be delayed by
 * a slow network and — much more to the point — cannot be delayed by an
 * attacker holding an old fix and posting it late. The server still bounds it
 * against its own clock; see `gps-gate.ts` for what happens to a fix claiming
 * to be from the future.
 */
export interface GpsFix {
  latitude: number;
  longitude: number;
  accuracyM: number;
  capturedAt: Date;
}

/**
 * Everything the verification path is allowed to know about the caller.
 *
 * `callerUserId` comes from `getAuthenticatedContext()` and NEVER from the
 * request body. There is no field here for a client-asserted identity, which is
 * the point: a shape with no slot for it cannot accidentally be filled from
 * one.
 *
 * `ipHash` is already hashed by the time it reaches here — `connection_attempts`
 * and `rate_limit_events` both store hashes, because an IP is personal data and
 * both uses only need the value to be comparable to itself.
 */
export interface RequestContext {
  callerUserId: string;
  ipHash: string | null;
  userAgent: string | null;
  /** Injected rather than read from the clock, so every time-dependent rule is testable. */
  now: Date;
}

/**
 * What was logged to justify an outcome (§4.1's `evidence`).
 *
 * §4.1 types this as `Record<string, unknown>`. It is narrowed here to name the
 * fields the audit log and the atomic write actually need, while keeping the
 * open index signature so the shape is still a superset of what §4.1 declared.
 * The reason for narrowing: `createVerifiedConnection` has to put these exact
 * values into `connection_attempts` columns, and digging typed numbers back out
 * of an untyped bag is precisely the kind of code that silently starts logging
 * `undefined` and is never noticed, because nothing reads an audit log until it
 * matters.
 */
export interface VerificationEvidence {
  /** The session this outcome came from. Null only on the NFC path, where the write creates one. */
  sessionId: string | null;
  /**
   * The counterpart, resolved SERVER-SIDE from the session or the card code —
   * never from the request. Carried on failures too, because a rejection that
   * cannot say who it was against is a rejection §4.3's relaxation lookup and
   * §4.4's tuning queries cannot use.
   */
  presenterUserId: string | null;
  /** Already hashed. `connection_attempts.ip_hash` stores hashes, never raw addresses. */
  ipHash: string | null;
  userAgent: string | null;
  /** Server-computed. Null for NFC, which has no GPS gate. Never returned to a user. */
  distanceM: number | null;
  scannerAccuracyM: number | null;
  presenterAccuracyM: number | null;
  /** The radius actually applied — normal or relaxed. */
  radiusConfigUsedM: number | null;
  /** The accuracy floor actually applied. */
  accuracyConfigUsedM: number | null;
  /** `relaxed` iff the §4.3 relaxation path fired for this attempt. */
  radiusMode: "normal" | "relaxed";
  /** On a relaxed attempt, the earlier failure that unlocked it. */
  relaxationSourceAttemptId: string | null;
  /** Set when the meeting happened inside a known event. Not used yet — events are a later phase. */
  eventId: string | null;
  /** Anything else worth keeping. Kept open to match §4.1's declared shape. */
  [key: string]: unknown;
}

declare const verifiedBrand: unique symbol;

/** The brand. Not exported as a value anywhere; see the header. */
interface VerifiedBrand {
  readonly [verifiedBrand]: true;
}

export interface SuccessfulVerification {
  ok: true;
  /** The person who scanned or tapped. */
  initiatorUserId: string;
  /** The person who presented the code or owns the card. */
  counterpartUserId: string;
  method: VerificationMethodId;
  /**
   * §4.1: carries the card-vs-QR asymmetry as data, never as branching logic,
   * and never affects platform access — only outbound first-impression
   * richness.
   *
   * JUDGMENT CALL: §4.5 step 5 fixes `nfc_card` at `full`; §4.2 never states
   * the QR value, and §4.1 only says the two differ. `qr_gps` is therefore
   * `preview` here. The reasoning: a card is a deliberate object its owner
   * chose, branded and handed over, so it carries a fuller first impression;
   * a QR scan is incidental. Nothing consumes this field yet, so the choice
   * costs nothing today and is recorded here rather than discovered later.
   */
  profileRichness: "full" | "preview";
  location?: { latitude: number; longitude: number; accuracyM: number };
  evidence: VerificationEvidence;
}

export interface FailedVerification {
  ok: false;
  reason: RejectionReason;
  evidence: VerificationEvidence;
}

/**
 * A successful outcome that provably came out of a verifier. This is the only
 * type `createVerifiedConnection` accepts.
 */
export type VerifiedOutcome = SuccessfulVerification & VerifiedBrand;

/**
 * The union a verifier returns, and the ONLY thing anything downstream deals
 * in.
 *
 * Note that the success arm is the BRANDED `VerifiedOutcome`, not the plain
 * `SuccessfulVerification`. That is the load-bearing detail: it means a value
 * of this type whose `ok` is true could only have been produced by
 * `sealVerified()`, so passing a verifier's result straight to
 * `createVerifiedConnection` type-checks while a hand-written
 * `{ ok: true, ... }` literal does not — anywhere, including inside this
 * package.
 *
 * `SuccessfulVerification` remains exported for the places that need to talk
 * about the SHAPE of a success (a function parameter, a test helper) without
 * claiming one happened.
 */
export type VerificationOutcome = VerifiedOutcome | FailedVerification;

/**
 * §4.1's interface, unchanged.
 *
 * `parse` is shape-only (Zod) and must never make an authorization decision —
 * separating "is this the right shape?" from "is this allowed?" is what stops a
 * schema tweak from quietly becoming a policy change. `verify` returns an
 * outcome; it never throws for an ordinary refusal, because a refusal is a
 * result that has to be logged, not an exception that unwinds past the logging.
 *
 * A future verification method means one new implementation of this interface
 * and zero changes to connection, meeting or feed logic.
 */
export interface VerificationMethod<TInput> {
  readonly id: VerificationMethodId;
  parse(raw: unknown): TInput;
  verify(ctx: RequestContext, input: TInput): Promise<VerificationOutcome>;
}

/** Convenience for building the failure half of an outcome without repeating the shape. */
export function reject(
  reason: RejectionReason,
  evidence: Partial<VerificationEvidence> = {},
): FailedVerification {
  return {
    ok: false,
    reason,
    evidence: {
      sessionId: null,
      presenterUserId: null,
      ipHash: null,
      userAgent: null,
      distanceM: null,
      scannerAccuracyM: null,
      presenterAccuracyM: null,
      radiusConfigUsedM: null,
      accuracyConfigUsedM: null,
      radiusMode: "normal",
      relaxationSourceAttemptId: null,
      eventId: null,
      ...evidence,
    },
  };
}
