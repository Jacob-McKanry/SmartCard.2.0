/**
 * The only place a `RejectionReason` may be turned into text a human sees.
 *
 * §4.2 STEP 7 IS A SECURITY REQUIREMENT, NOT A COPY GUIDELINE
 * "Rejections write a `connection_attempts` row with the reason and numbers.
 * The user sees only a plain message ('You need to be near each other to
 * connect') — never the distance, radius, or the other party's location, which
 * would let someone probe for a person's position by repeated scanning."
 *
 * The attack is worth spelling out because it is easy to under-rate. If a
 * rejection said "you are 420m away", anyone holding a valid token could stand
 * in three places, read three distances, and trilaterate the presenter's
 * position to within metres — turning a connection endpoint into a
 * people-finder for a product whose entire premise is that it has no such
 * thing. A chatty error message here is a location leak, not a UX improvement.
 *
 * THE RULE THIS FILE FOLLOWS
 * A message may describe the CALLER'S OWN device and the caller's own actions.
 * It may not describe the other party, the comparison between them, or any
 * threshold. So "we couldn't get a precise enough fix on your phone" is
 * allowed — the caller's phone already knows its own accuracy — while
 * "their location is stale", "you are too far apart" (with any number), and
 * anything at all about the radius, are not.
 *
 * TWO CONSEQUENCES THAT LOOK LIKE BUGS AND ARE NOT
 *  1. `blocked` returns the same words as `session_not_found` and several
 *     others. Telling someone they have been blocked is both a safety problem
 *     and an invitation to make a second account — the same reasoning that
 *     keeps a `blocked_user_id` branch out of the `blocks` read policy
 *     (20260809211200). It must stay indistinguishable from an ordinary
 *     failure.
 *  2. Nothing here ever mentions relaxation, in either direction. A relaxed
 *     acceptance reads exactly like a normal one and a relaxed rejection like
 *     any other. §4.3's amendment: telling a user "we widened the radius for
 *     you" teaches the attack in a single sentence, because it announces that
 *     failing repeatedly is rewarded.
 */

import type { RejectionReason } from "./rejection-reasons";

/** Used for everything that is not the caller's own device's fault. */
const GENERIC =
  "We couldn't complete that connection. Ask them to show you a fresh code and try again.";

const PROXIMITY = "You need to be near each other to connect.";

const MESSAGES: Record<RejectionReason, string> = {
  // Token and session problems. All generic: which part failed is exactly what
  // an attacker probing the endpoint wants to learn.
  invalid_signature: GENERIC,
  malformed_token: GENERIC,
  token_expired: "That code has expired. Ask them to show you a fresh one.",
  session_not_found: GENERIC,
  session_expired: "That code has expired. Ask them to show you a fresh one.",
  nonce_mismatch: GENERIC,

  // Graph position.
  self_connect: "That's your own code.",
  already_connected: "You're already connected.",
  // Deliberately identical to GENERIC — see consequence 1 in the header.
  blocked: GENERIC,

  // The GPS gate. Everything about the OTHER party or the comparison collapses
  // into one message; only the caller's own device is described.
  scanner_location_missing:
    "SmartCard needs your location to confirm you met in person. Turn on location access and try again.",
  scanner_location_stale:
    "We couldn't get a current location from your phone. Try again in a moment.",
  scanner_accuracy_too_low:
    "We couldn't pin down your location precisely enough. Move somewhere with a clearer view of the sky and try again.",
  presenter_location_missing: PROXIMITY,
  presenter_location_stale: PROXIMITY,
  presenter_accuracy_too_low: PROXIMITY,
  too_far: PROXIMITY,
  gps_check_failed: PROXIMITY,

  // NFC. `card_not_found` and `card_unassigned` share wording with
  // `card_revoked` on purpose: distinguishing them would turn the endpoint into
  // an oracle for which 48-bit card codes exist, which is precisely what the
  // rate limit in §4.6 is there to make expensive. Do not "improve" this by
  // telling the tapper the card was revoked.
  card_not_found: "That card isn't set up yet.",
  card_unassigned: "That card isn't set up yet.",
  card_revoked: "That card isn't set up yet.",

  // Rate limiting. Says that it is temporary and nothing about the ceiling.
  rate_limited: "You've tried that too many times. Wait a little while and try again.",
  session_burned: GENERIC,

  commit_refused: GENERIC,
  internal_error: GENERIC,
};

export function userFacingMessage(reason: RejectionReason): string {
  return MESSAGES[reason] ?? GENERIC;
}
