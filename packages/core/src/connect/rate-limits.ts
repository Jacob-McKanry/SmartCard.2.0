/**
 * §4.6's rate limits, as named actions.
 *
 * WHEN EACH ONE IS CONSUMED, AND WHY THAT IS NOT THE SAME AS WHEN IT IS ENFORCED
 *
 * §4.2 step 5 lists rate limits as check (9) — LAST, after the signature, the
 * expiry, the session lookup, the nonce, the self-connect test, the graph
 * checks and the GPS gate. That ordering is followed exactly, and it is worth
 * writing down why it is not the mistake it first looks like, because "rate
 * limit first" is the reflex.
 *
 * The concern with checking limits last is that a flood of requests failing at
 * check (1) never reaches check (9) and so is never limited. On this endpoint
 * that concern does not apply: checks (1) and (2) are an HMAC and an integer
 * comparison, with no database access whatsoever. The first thing that touches
 * the database is check (3), and reaching it requires a signature the attacker
 * cannot produce. The cheap crypto gate in front of all I/O is what makes
 * limits-last safe here, and it is why the order can be honoured as written
 * instead of "improved".
 *
 * Two consequences are handled deliberately rather than inherited:
 *
 *  1. **Consumption happens at the top of the request, enforcement at step 9.**
 *     If budget were only spent when check (9) was reached, an attacker could
 *     get unlimited retries by ensuring each request failed earlier. So every
 *     connect request records its event immediately (`rate_limit_consume` in
 *     the database records before it counts, for the same reason), and the
 *     resulting verdict is *acted on* at the position §4.2 gives it. Budget is
 *     spent by trying; the refusal appears where the document says it appears.
 *
 *  2. **The NFC path is ordered differently, on purpose.** §4.5 gives no
 *     validation order, and unlike QR its very first step is a database lookup
 *     by card code — there is no cheap cryptographic gate in front of it,
 *     because on that path the card code IS the secret. So the per-user and
 *     per-IP limits are enforced *before* the card lookup there, and the
 *     per-card limit immediately after it (it cannot be evaluated before the
 *     code has been resolved to a card). This is a deviation from nothing —
 *     §4.5 specifies no order — but it is a difference between the two paths,
 *     so it is recorded here rather than left for a reader to notice.
 */

export const RATE_LIMIT_ACTIONS = {
  /** Every request to any connect endpoint, keyed by hashed IP (§4.6, last row). */
  connectEndpoint: "connect_endpoint",
  /** `qr/session` create, per user, per hour. */
  qrSessionCreate: "qr_session_create",
  /** `qr/redeem`, per user, per hour. */
  qrRedeem: "qr_redeem",
  /** `nfc/redeem`, per user and per card, per hour. */
  nfcRedeem: "nfc_redeem",
  /**
   * The non-user card preview (`/card/<code>` signed out, and `/c/<token>`),
   * per IP and per card, per hour. Thresholds seeded by 20260815120000.
   *
   * NOT A §4.6 LIMIT — §4.6 predates this feature and lists nothing for it. It
   * is registered here anyway, beside the others, because this object is the
   * one place an action name is allowed to exist: two copies of the literal
   * `"card_preview"` in two files is precisely how a rate limit silently
   * becomes two half-empty counters, which is the one failure mode
   * `rate_limit_events.subject_kind`'s CHECK constraint already exists to
   * prevent one level down.
   *
   * IT IS ALSO THE ONLY ACTION IN THIS LIST AN UNAUTHENTICATED CALLER CAN
   * SPEND, and that is the part worth stopping on. Every other action here has
   * a signed-in user behind it, and `nfc-verifier.ts` leans on that in as many
   * words: the per-user budget "is the limit that actually resists
   * brute-forcing card codes, because a guesser has to be a signed-in user".
   * On the preview path there is no account to charge, so that limit does not
   * exist. What stands in its place is the per-IP and per-card pair, plus the
   * 48 bits of non-user-chosen entropy in the card code — which was always the
   * control doing the real work.
   */
  cardPreview: "card_preview",
  /**
   * Not a limit — a coalescing marker. Records that the card's owner was pushed
   * a tap notification, so the next tap inside
   * `nfc_tap_notification_coalesce_seconds` does not push again (§4.5
   * amendment). It lives in the same event table because it is exactly the same
   * question: "has this subject had one of these in the last N seconds?"
   */
  nfcTapNotify: "nfc_tap_notify",
} as const;

export type RateLimitAction = (typeof RATE_LIMIT_ACTIONS)[keyof typeof RATE_LIMIT_ACTIONS];

/** All §4.6 limits are per-hour. Kept as one constant so it cannot drift between call sites. */
export const HOUR_SECONDS = 3600;
