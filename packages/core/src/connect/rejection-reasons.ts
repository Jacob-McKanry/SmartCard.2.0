/**
 * The closed set of reasons a connection attempt can be refused.
 *
 * These strings are written verbatim to `connection_attempts.rejection_reason`,
 * which the migration deliberately left as free text so the set could grow
 * without a migration (20260809210700). Keeping the set closed *here* instead
 * gives the same tuning dataset the comparability it needs — §4.4's questions
 * are all "how many attempts failed for reason X?" — while still letting a new
 * reason be added in one place.
 *
 * TWO OF THESE VALUES ARE LOAD-BEARING BEYOND LOGGING, and changing them
 * silently changes a security mechanism:
 *
 *   `too_far` and `scanner_accuracy_too_low` / `presenter_accuracy_too_low`
 *   are the only reasons that unlock automatic radius relaxation (§4.3
 *   amendment, "Eligibility, tightly scoped"). A failure for a bad HMAC, an
 *   expired token, a consumed session, a block or an existing connection
 *   unlocks nothing — without that restriction an attacker could spend two junk
 *   requests to buy a wider radius. `RELAXATION_UNLOCKING_REASONS` below is
 *   that list, and it is the thing the database query filters on.
 *
 * NONE of these strings may reach a user. §4.2 step 7 is explicit: a rejection
 * says only that it didn't work, never the distance, the radius, or anything
 * about the other party's position. `userFacingMessage()` in `user-messages.ts`
 * is the only thing permitted to turn one of these into text a human sees.
 */

export const REJECTION_REASONS = [
  // --- QR token / session ---------------------------------------------------
  /** HMAC did not verify. Nothing in the payload was interpreted (§4.2 step 5.1). */
  "invalid_signature",
  /** The token was structurally unparseable *after* its signature verified. */
  "malformed_token",
  /** `exp` has passed (§4.2 step 5.2). */
  "token_expired",
  /** No session row with that `sid`, or it is not `active` (§4.2 step 5.3). */
  "session_not_found",
  /** The session's own `expires_at` has passed (§4.2 step 5.4). */
  "session_expired",
  /** The nonce matched neither `current_nonce` nor `previous_nonce` (§4.2 step 5.5). */
  "nonce_mismatch",

  // --- Graph position -------------------------------------------------------
  /** Presenter and scanner are the same person (§4.2 step 5.6). */
  "self_connect",
  /** An active connection already exists (§4.2 step 5.7). */
  "already_connected",
  /** A block exists in either direction (§4.2 step 5.7). */
  "blocked",

  // --- GPS gate (§4.3) ------------------------------------------------------
  /** The request carried no usable scanner fix at all — missing, or permission denied. */
  "scanner_location_missing",
  /** The presenter has never posted a heartbeat, so the session has no position. */
  "presenter_location_missing",
  /** The scanner's fix is older than the freshness bound. */
  "scanner_location_stale",
  /** The presenter's heartbeat is older than `presenter_location_max_age_seconds`. */
  "presenter_location_stale",
  /** The scanner's fix is worse than the accuracy floor. */
  "scanner_accuracy_too_low",
  /** The presenter's fix is worse than the accuracy floor. */
  "presenter_accuracy_too_low",
  /** Server-computed distance exceeded the radius in force. */
  "too_far",
  /** Any error *inside* the GPS check. §4.3's table: an error rejects. */
  "gps_check_failed",

  // --- NFC (§4.5) -----------------------------------------------------------
  /** No card with that code. Indistinguishable to the caller from every other refusal. */
  "card_not_found",
  /** The card is `unassigned` — nobody owns it, so there is nobody to connect to. */
  "card_unassigned",
  /** The card is `revoked`: the owner's kill switch for a lost or stolen card (§4.7 threat 7). */
  "card_revoked",

  // --- Rate limiting (§4.6) -------------------------------------------------
  "rate_limited",
  /** Five failures against one session burns it (§4.6). */
  "session_burned",

  // --- Catch-all ------------------------------------------------------------
  /**
   * The atomic commit refused for a reason the service layer had already
   * checked — i.e. the world changed between the check and the write. Logged
   * distinctly so that a spike in these is visible as the race it is rather
   * than being filed under whichever check it happened to duplicate.
   */
  "commit_refused",
  /** Anything unexpected. Present so that "we do not know" still fails closed and still logs. */
  "internal_error",
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

/**
 * The only rejection reasons that count toward unlocking a relaxed radius
 * (§4.3 amendment). Deliberately a hand-written list rather than "anything
 * GPS-ish": a stale or missing location is a *broken heartbeat*, not evidence
 * that two people standing together cannot convince their phones of it, and
 * relaxing the radius does nothing to fix it. Relaxation exists for the pair
 * whose fixes are real but disagree — that is `too_far` and the two accuracy
 * floors, and nothing else.
 */
export const RELAXATION_UNLOCKING_REASONS: readonly RejectionReason[] = [
  "too_far",
  "scanner_accuracy_too_low",
  "presenter_accuracy_too_low",
];

export function unlocksRelaxation(reason: RejectionReason): boolean {
  return RELAXATION_UNLOCKING_REASONS.includes(reason);
}
