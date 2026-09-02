import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { emailUnsubscribeSecret } from "@/server/env";

/**
 * The unsubscribe link every invite email carries — HMAC-SHA256 over the
 * lowercased address, same construction as `hashIpAddress` in
 * `connect/request-context.ts`, with its own dedicated secret
 * (`emailUnsubscribeSecret()`) for the reason that function's env doc gives:
 * a shared key means one leak compromises two unrelated things.
 *
 * WHY NO EXPIRY, UNLIKE THE QR TOKEN (`packages/core/src/connect/qr-token.ts`)
 *
 * A QR token has to expire — it authorizes an action (claiming a connection)
 * and staying valid past its window is the whole attack surface §4.2 exists
 * to close. An unsubscribe link authorizes nothing but its own single
 * purpose, and the person it was mailed to may not read that email for
 * months. Expiring it would mean an old invite's unsubscribe link stops
 * working — the opposite of what CAN-SPAM's "honor every unsubscribe
 * request" expects, and there is no attacker upside to a long-lived one: the
 * worst it can ever do, forged or not, is stop mail to one address.
 *
 * WHY THE EMAIL ISN'T ENCRYPTED INTO THE TOKEN, JUST SIGNED ALONGSIDE IT
 *
 * The link is `/api/unsubscribe?email=<address>&sig=<token>` — the address
 * travels in the clear. That is not a leak: the recipient already knows their
 * own address (it is the one this was mailed to), and this token's only job
 * is proving the caller was HANDED this exact address by us, not that nobody
 * else can read it back out of a URL they already possess.
 */
export function signUnsubscribeToken(email: string): string {
  return createHmac("sha256", emailUnsubscribeSecret())
    .update(email.trim().toLowerCase())
    .digest("base64url");
}

/**
 * Constant-time comparison, for the identical reason `qr-token.ts`'s own
 * `timingSafeEqual` export exists: `===` on strings short-circuits at the
 * first differing byte, which leaks how many leading bytes of a forged token
 * were already correct to an endpoint an attacker can call repeatedly.
 */
export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = Buffer.from(signUnsubscribeToken(email));
  const provided = Buffer.from(token);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
