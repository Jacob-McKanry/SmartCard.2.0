import "server-only";

import { SignJWT } from "jose";

import { supabaseJwtSecret, supabaseUrl } from "@/server/env";

/**
 * Step 3 of the Kinde -> Supabase bridge: mint the short-lived Supabase-format
 * JWT that makes `auth.uid()` resolve.
 *
 * WHY WE MINT A TOKEN INSTEAD OF SENDING KINDE'S TOKEN STRAIGHT TO SUPABASE
 *
 * The short version: Supabase cannot be pointed at Kinde, and even if it could,
 * a Kinde token does not say the thing our policies read. The long version is
 * the 2026-08-13 amendment to §5.4 of the architecture proposal, which records
 * the checks that were actually run. The two decisive facts:
 *
 *  - `auth.uid()` is `(request.jwt.claims ->> 'sub')::uuid`. Kinde's `sub` is
 *    `kp_<32 hex>` for all 337 migrated users, which is not a uuid — a raw
 *    Kinde token makes every policy evaluation raise SQLSTATE 22P02 rather than
 *    simply denying. Verified against the live database.
 *  - Every policy in this schema compares against `public.users.id`. That value
 *    is ours, not Kinde's, so *something* has to perform the mapping. This
 *    module is that something, and `ensureUser()` is the mapping.
 *
 * WHAT THE TOKEN CAN AND CANNOT DO
 *
 * `sub` is the resolved `public.users.id` and `role` is `authenticated`, so the
 * bearer gets exactly the privileges the migrations grant `authenticated` —
 * narrow, column-scoped, and filtered per row by RLS. It is not a service-role
 * token and cannot be turned into one, because `role` is set here, server-side,
 * from a value we computed rather than from anything the client sent.
 *
 * WHY IT IS SHORT-LIVED
 *
 * Five minutes, per §5.4. This token is the one credential in the system that
 * grants direct database access as a specific person, and there is no
 * revocation list for it — the only thing bounding the damage of a leaked token
 * is how quickly it stops working. Five minutes is long enough that no single
 * request needs to refresh mid-flight, and short enough that a token captured
 * from a log or a proxy is worthless by the time anyone reads it. It is minted
 * per request and never stored, so nothing depends on it lasting longer.
 */

/** Seconds. See "why it is short-lived" above before changing this. */
const TOKEN_LIFETIME_SECONDS = 5 * 60;

let cachedKey: Uint8Array | null = null;

function signingKey(): Uint8Array {
  if (cachedKey === null) {
    cachedKey = new TextEncoder().encode(supabaseJwtSecret());
  }
  return cachedKey;
}

/**
 * @param userId `public.users.id` — already resolved and already verified to
 *   belong to the authenticated Kinde identity. This function does not check
 *   that; it signs what it is given, which is why nothing but `ensureUser()`'s
 *   return value should ever reach it.
 */
export async function mintSupabaseAccessToken(userId: string): Promise<string> {
  return await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    // `auth.uid()` reads exactly this claim and casts it to uuid.
    .setSubject(userId)
    // Supabase's API gateway expects the `authenticated` audience for a user
    // token; the policies additionally carry `to authenticated` (see
    // 20260809211100), so a token without this role matches no policy at all.
    .setAudience("authenticated")
    // Cosmetic rather than enforced — the Data API checks the signature, not
    // the issuer — but it keeps our tokens shaped like the ones Supabase Auth
    // issues, so anything inspecting a token later is not surprised by ours.
    .setIssuer(`${supabaseUrl()}/auth/v1`)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_LIFETIME_SECONDS}s`)
    .sign(signingKey());
}
