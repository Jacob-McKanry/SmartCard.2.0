/**
 * The signed QR token (§4.2 step 2).
 *
 *   payload  = { sid, nonce, iat, exp: iat + qr_token_ttl_seconds }
 *   token    = base64url(payload) + "." + base64url(HMAC-SHA256(secret, payload))
 *
 * The QR contains no personal data — a session id and a nonce, meaningless
 * without our server. That matters because a QR code is, by construction,
 * shown to strangers and photographed.
 *
 * WHY SIGNATURE VERIFICATION HAPPENS BEFORE THE PAYLOAD IS PARSED
 * §4.2 step 5.1 is emphatic: "HMAC signature first, reject immediately on
 * failure, never interpret unverified data". `verifyQrToken` computes the MAC
 * over the payload SEGMENT AS RECEIVED — the exact base64url characters — and
 * only decodes and JSON-parses that segment once the MAC matches. Verifying a
 * re-serialised object instead would open the classic gap where two different
 * byte sequences produce the same parsed object, one of which we signed and one
 * of which we did not.
 *
 * WHY THE COMPARISON IS CONSTANT-TIME
 * `a === b` on strings short-circuits at the first differing byte, so the time
 * it takes leaks how many leading bytes were right. Against an endpoint an
 * attacker can call repeatedly, that is a way to construct a valid MAC one byte
 * at a time. `timingSafeEqual` below compares every byte regardless.
 *
 * WHY Web Crypto AND NOT `node:crypto`
 * §1.3 requires `packages/core` to be importable unchanged by both a server and
 * a phone. `globalThis.crypto.subtle` is present in Node 22, in the Next.js
 * runtimes, and in React Native with Expo's polyfill; `node:crypto` is not. The
 * cost is that signing and verifying are async, which is invisible here because
 * every caller is already async.
 */

import { z } from "zod";

/**
 * The claims inside the token. Deliberately tiny.
 *
 * Note what is NOT here and must never be added: the presenter's user id, their
 * name, their coordinates, or anything else about them. Everything the server
 * needs to identify the presenter is reachable from `sid`, on the server, where
 * it is subject to RLS and to the session's own status. A field added here is a
 * field printed on a code that gets photographed.
 */
export const qrTokenPayloadSchema = z.object({
  /** `connection_sessions.id`. */
  sid: z.guid(),
  /** The one-time value currently displayed. Matched against `current_nonce` or `previous_nonce`. */
  nonce: z.string().min(16).max(128),
  /** Issued-at, seconds since epoch. */
  iat: z.number().int().nonnegative(),
  /** Expiry, seconds since epoch. `iat + qr_token_ttl_seconds`. */
  exp: z.number().int().nonnegative(),
});

export type QrTokenPayload = z.infer<typeof qrTokenPayloadSchema>;

export type QrTokenVerification =
  | { ok: true; payload: QrTokenPayload }
  | { ok: false; reason: "invalid_signature" | "malformed_token" };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(signature);
}

/**
 * Length-independent, byte-by-byte comparison. Returns false for differing
 * lengths without a short-circuit that reveals which length was wrong.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export async function signQrToken(secret: string, payload: QrTokenPayload): Promise<string> {
  if (secret.length === 0) {
    // A token signed with an empty secret is a token anyone can forge. Refusing
    // loudly beats minting something that looks fine and verifies for everyone.
    throw new Error("QR signing secret is empty — refusing to mint a forgeable token.");
  }
  const encodedPayload = base64urlEncode(
    encoder.encode(JSON.stringify(qrTokenPayloadSchema.parse(payload))),
  );
  const mac = await hmacSha256(secret, encodedPayload);
  return `${encodedPayload}.${base64urlEncode(mac)}`;
}

/**
 * Verifies signature first, then structure. Never the other way round.
 *
 * The two failure reasons are distinguished only for the audit log. Both
 * produce the same message to the user, and neither is ever accompanied by a
 * hint about which part was wrong.
 */
export async function verifyQrToken(secret: string, token: unknown): Promise<QrTokenVerification> {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
    // Bounded before anything else touches it: an unbounded string handed to a
    // regex and a MAC is a cheap way to make the server do expensive work.
    return { ok: false, reason: "malformed_token" };
  }

  const separator = token.indexOf(".");
  if (
    separator <= 0 ||
    separator === token.length - 1 ||
    token.indexOf(".", separator + 1) !== -1
  ) {
    return { ok: false, reason: "malformed_token" };
  }

  const encodedPayload = token.slice(0, separator);
  const encodedMac = token.slice(separator + 1);

  const providedMac = base64urlDecode(encodedMac);
  if (providedMac === null) {
    return { ok: false, reason: "malformed_token" };
  }

  // The MAC is computed over the received characters, not over anything parsed
  // out of them. See the header.
  const expectedMac = await hmacSha256(secret, encodedPayload);
  if (!timingSafeEqual(providedMac, expectedMac)) {
    return { ok: false, reason: "invalid_signature" };
  }

  // Only now is the payload interpreted at all.
  const payloadBytes = base64urlDecode(encodedPayload);
  if (payloadBytes === null) {
    return { ok: false, reason: "malformed_token" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(decoder.decode(payloadBytes));
  } catch {
    return { ok: false, reason: "malformed_token" };
  }

  const parsed = qrTokenPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, reason: "malformed_token" };
  }

  return { ok: true, payload: parsed.data };
}

/**
 * §4.2 step 5.2 — `exp` not passed.
 *
 * Separate from `verifyQrToken` on purpose: expiry is a policy question about
 * the current time, and the signature check is a question about bytes. Keeping
 * them apart is what lets the validation order in §4.2 step 5 be implemented as
 * two visibly distinct steps in the order the document lists them, rather than
 * as one function whose internal ordering has to be taken on trust.
 */
export function isTokenExpired(payload: QrTokenPayload, now: Date): boolean {
  return payload.exp * 1000 <= now.getTime();
}

/**
 * A fresh nonce: 32 hex characters, 128 bits.
 *
 * Far more than needed to make guessing hopeless — the nonce only has to be
 * unguessable for the 45 seconds a token lives, against a session that burns
 * after 5 failures. It is generous because there is no reason not to be, and
 * because a short nonce is the kind of thing that looks fine until someone
 * builds a rainbow table of the small ones.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
