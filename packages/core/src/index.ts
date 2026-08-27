/**
 * `@smartcard/core` — the platform-independent rules that must not differ
 * between web and mobile (§1.3).
 *
 * As of the Connect Flow phase this package holds the connection-verification
 * layer described in §4: the `VerificationMethod`/`VerificationOutcome`
 * abstraction (§4.1), the QR and NFC verifiers (§4.2, §4.5), the GPS proximity
 * gate and its automatic relaxation (§4.3), the haversine distance calculation,
 * and `createVerifiedConnection` — the single entry point to the social graph.
 *
 * It still contains no React, no network calls and no database access. The
 * outside world reaches it through one interface, `ConnectStore` (`ports.ts`),
 * whose production implementation lives in `apps/web/src/server/connect/`. That
 * constraint is what makes §4.7's threat model testable: every adversarial case
 * — a consumed session, a rotated nonce, a scan from two kilometres away, a
 * block that appears mid-request — is a few lines against a fake store rather
 * than a database fixture.
 *
 * ONE EXPORT IS DELIBERATELY MISSING FROM THIS FILE, AND ITS ABSENCE IS A
 * SECURITY MECHANISM. `sealVerified()` — the only function that can produce the
 * branded `VerifiedOutcome` that `createVerifiedConnection` accepts — is not
 * re-exported here, and `package.json` declares `"exports": { ".": ... }` so it
 * cannot be deep-imported either. That is what makes §4.1's "no API handler
 * assembles a connection itself" a compile error rather than a convention. Do
 * not add it to this file.
 */

// --- §4.3 / §4.4: distance ---------------------------------------------------
export { haversineDistanceM, isUsableCoordinate, type LatLng } from "./geo/haversine";

// --- §4.1: the abstraction ---------------------------------------------------
export {
  reject,
  type FailedVerification,
  type GpsFix,
  type RequestContext,
  type SuccessfulVerification,
  type VerificationEvidence,
  type VerificationMethod,
  type VerificationOutcome,
  type VerifiedOutcome,
} from "./connect/verification";

export {
  REJECTION_REASONS,
  RELAXATION_UNLOCKING_REASONS,
  unlocksRelaxation,
  type RejectionReason,
} from "./connect/rejection-reasons";

// --- §2.5 / §4.3: configuration ----------------------------------------------
export {
  CONNECT_CONFIG_KEYS,
  ConfigurationError,
  MIN_RELAXED_RADIUS_TO_ACCURACY_RATIO,
  parseVerificationConfig,
  verificationConfigSchema,
  type ConnectConfigKey,
  type VerificationConfig,
} from "./connect/config";

// --- §4.3: the GPS gate ------------------------------------------------------
export {
  CLOCK_SKEW_TOLERANCE_SECONDS,
  evaluateGpsGate,
  type GpsGateInput,
  type GpsGateThresholds,
  type GpsGateVerdict,
} from "./connect/gps-gate";

// --- §2.6: post-acceptance event tagging (metadata, never a gate) ------------
// Exported for the same reason `evaluateGpsGate` is: it is a rule with a
// documented answer for every input, and a reviewer should be able to exercise
// it directly. `resolveAutoTaggedEventId` is deliberately NOT exported — it is
// the verifier's plumbing, and nothing outside `qr-verifier.ts` should be
// deciding a meeting's event.
export { selectAutoTaggedEvent, type AutoTagInput } from "./connect/event-tagging";

export {
  evaluateRelaxation,
  thresholdsFor,
  type RelaxationDecision,
  type RelaxationHistory,
} from "./connect/relaxation";

// --- §4.2 step 2: the signed token -------------------------------------------
export {
  generateNonce,
  isTokenExpired,
  qrTokenPayloadSchema,
  signQrToken,
  timingSafeEqual,
  verifyQrToken,
  type QrTokenPayload,
  type QrTokenVerification,
} from "./connect/qr-token";

// --- §4.6: rate limiting -----------------------------------------------------
export { HOUR_SECONDS, RATE_LIMIT_ACTIONS, type RateLimitAction } from "./connect/rate-limits";

// --- The port the app implements ---------------------------------------------
export type {
  AttemptLogRecord,
  CandidateEventRecord,
  CardRecord,
  CommitInput,
  CommitResult,
  ConnectStore,
  RateLimitRequest,
  SessionRecord,
} from "./connect/ports";

// --- §4.2 / §4.5: the verifiers ----------------------------------------------
export { createQrVerifier, type QrVerifierDeps } from "./connect/qr-verifier";
export {
  createNfcVerifier,
  type NfcVerificationContext,
  type NfcVerifierDeps,
} from "./connect/nfc-verifier";

// --- §4.1: the one writer ----------------------------------------------------
export {
  ConnectionCommitError,
  createVerifiedConnection,
  type CreatedConnection,
} from "./connect/create-verified-connection";

// --- §4.2 step 7: what a user is allowed to be told ---------------------------
export { userFacingMessage } from "./connect/user-messages";

// --- §2.6: the Events RSVP rules ---------------------------------------------
// Display-side only, and deliberately so: the database computes and enforces
// every stored RSVP status (20260814051200), and `authenticated` holds no write
// grant on `event_rsvps` at all. These functions exist so a screen can say
// "this needs approval" or "you are 3rd in line" before anybody taps. See the
// module header — the SQL is authoritative wherever the two disagree.
export {
  deriveDecidedRsvp,
  deriveRequestedRsvp,
  isFull,
  nextWaitlistPromotions,
  seatsRemaining,
  summarizeConnectionsAttending,
  waitlistOrder,
  waitlistPositionOf,
  type ConnectionAttendingRow,
  type ConnectionsAttendingSummary,
  type RsvpDecisionContext,
  type RsvpDecisionOutcome,
  type RsvpRequestContext,
  type RsvpRequestOutcome,
  type WaitlistEntry,
} from "./events/rsvp-rules";

// Guest-list import: what a CSV from Luma, Eventbrite or Partiful *means*.
// Not a security boundary — `public.import_event_attendees` re-checks every
// gate from values it reads itself, so a host bypassing this module gains
// nothing. See the module header for the one rule here that is not cosmetic:
// a `declined` guest is somebody the host turned away, and importing them
// would record the opposite of what happened.
export {
  IGNORE_COLUMN,
  classifyStatusValue,
  detectColumnMapping,
  normaliseImportRows,
  normaliseSocialHandle,
  summariseStatusValues,
  type ColumnAssignment,
  type ColumnMapping,
  type ImportField,
  type ImportRow,
  type NormalizeOptions,
  type NormalizeResult,
  type StatusClass,
} from "./events/attendee-import";
