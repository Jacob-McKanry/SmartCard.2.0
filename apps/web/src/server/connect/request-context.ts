import "server-only";

import { createHmac } from "node:crypto";

import type { RequestContext } from "@smartcard/core";

import { connectIpHashSalt } from "@/server/env";

/**
 * Builds the `RequestContext` every verifier runs against.
 *
 * THE IDENTITY COMES FROM THE AUTH BRIDGE, NEVER FROM THE REQUEST.
 * `callerUserId` is `getAuthenticatedContext().userId` — the `public.users.id`
 * that `auth.uid()` resolves to for this request, established by verifying a
 * Kinde token against Kinde's JWKS and minting a Supabase token from it (§5.4).
 * Nothing in a request body reaches this field, and none of the connect request
 * schemas even has a slot for one.
 *
 * WHY THE IP IS HASHED HERE AND NOT LATER
 * `connection_attempts.ip_hash` and `rate_limit_events.subject_key` both store
 * hashes. Hashing at the edge means the raw address exists only inside this
 * function: nothing downstream can log it by accident, and nothing downstream
 * has to remember to. An IP is personal data, and both uses — audit and rate
 * limiting — need only that the value be comparable to itself.
 */

/**
 * HMAC-SHA-256 with a dedicated salt, truncated to 32 hex characters.
 *
 * HMAC rather than a bare `sha256(salt + ip)`: length-extension is not an
 * attack that matters here, but a keyed construction is the right default and
 * costs nothing. The salt is required (see `connectIpHashSalt`) because an
 * unsalted hash of an IP is reversible by enumerating the whole address space,
 * which is storing raw IPs while believing you did not.
 *
 * 128 bits of output is far beyond what a collision would need to matter: a
 * collision here would merge two addresses' rate-limit budgets, which is a
 * negligible fairness bug and not a security one.
 */
export function hashIpAddress(ip: string): string {
  return createHmac("sha256", connectIpHashSalt()).update(ip).digest("hex").slice(0, 32);
}

/**
 * Extracts the client IP from proxy headers.
 *
 * WHAT THIS IS AND IS NOT TRUSTED FOR. On Vercel the platform sets
 * `x-forwarded-for` and a client cannot forge the value the platform appends;
 * behind a different proxy, or locally, a client can send whatever it likes.
 * That is acceptable because of what the value is used for: a per-IP rate limit
 * that Q22(a) already requires to be generous, and an audit signal. It is never
 * an authorization input, and §4.3 is explicit that IP geolocation is "logged
 * as a signal only, never a substitute gate".
 *
 * Returns null when no header is present, and the caller treats that as its own
 * rate-limit subject rather than skipping the limit — see the route helper.
 */
export function clientIpFrom(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded.trim() !== "") {
    // Left-most entry is the original client; the rest are proxies.
    const first = forwarded.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }
  const real = headers.get("x-real-ip");
  return real !== null && real.trim() !== "" ? real.trim() : null;
}

export function buildRequestContext(input: {
  callerUserId: string;
  headers: Headers;
  now?: Date;
}): RequestContext {
  const ip = clientIpFrom(input.headers);
  return {
    callerUserId: input.callerUserId,
    ipHash: ip === null ? null : hashIpAddress(ip),
    // Bounded before it is stored: `user_agent` is attacker-controlled text
    // going into a database column, and there is no reason to accept a
    // megabyte of it.
    userAgent: input.headers.get("user-agent")?.slice(0, 512) ?? null,
    // Injected once per request and threaded through every time-dependent
    // check, so that "is this fix fresh?" and "has this token expired?" are
    // answered against the same instant rather than against a clock that moved
    // between two checks.
    now: input.now ?? new Date(),
  };
}
