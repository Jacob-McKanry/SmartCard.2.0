import "server-only";

import { importJWK, SignJWT } from "jose";

import { supabaseJwtSigningKey, supabaseUrl } from "@/server/env";

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
 *
 * WHAT KEY IT IS SIGNED WITH (Q27, second §5.4 amendment)
 *
 * ES256, with a P-256 private key **we** generated and imported into the
 * Supabase project's JWT Signing Keys — `SUPABASE_JWT_SIGNING_KEY`. There is
 * one signing path and no fallback: if that key is missing or malformed the
 * mint throws (`env.ts`), because the alternative to failing closed here is
 * signing with something the project may not trust, which produces an opaque
 * 401 on every request instead of one legible error at the source.
 *
 * This is the mechanism Supabase documents for exactly our case — "How to
 * create (mint) JWTs if access to the private key or shared secret is not
 * possible?": generate an ES256 key, import it as a standby key, rotate it in,
 * sign with it. Supabase's *own* current key cannot be used by us at all,
 * because Supabase holds its private half and will not export it; only Supabase
 * Auth can sign with that one.
 *
 * Two properties of this arrangement are the reason it is the right one, not
 * merely the modern one:
 *
 *  - **Verification does not need a secret.** The project verifies with the
 *    public half, published at `/auth/v1/.well-known/jwks.json`. The private
 *    half is held by this server (and by Supabase, since the dashboard import
 *    takes a private JWK — there is no verify-only import).
 *  - **Revocation is a dashboard action, not a redeploy.** If this key ever
 *    leaks, the owner revokes it in the signing-keys UI and every token signed
 *    with it stops being accepted immediately, with no code change.
 *
 * WHAT THIS REPLACED, AND WHY THAT MATTERED (history, settled 2026-08-14)
 *
 * This module originally signed HS256 with the project's shared JWT secret
 * (`SUPABASE_JWT_SECRET`). That secret turned out to be the project's
 * *previous* key — the project had already rotated to asymmetric signing keys,
 * and Supabase keeps a previous key alive only long enough for outstanding
 * tokens to expire. Signing with a key on its way out meant an outage that
 * would arrive without warning and hit every user at once.
 *
 * Because importing and rotating a signing key is a manual dashboard step no
 * code here can perform, the ES256 switch shipped with a temporary HS256
 * fallback so the app kept working across the rotation window. The rotation was
 * completed and confirmed against production on 2026-08-14 — the deprecated
 * path logged a loud warning whenever it was used, and production logs across a
 * real sign-in and every screen showed it never fired — so the fallback is gone
 * and the ES256 key is now required. The app can no longer sign with the
 * deprecated secret even by accident. (`SUPABASE_JWT_SECRET` itself must still
 * not be *revoked* in the Supabase dashboard: `SUPABASE_SERVICE_ROLE_KEY` is a
 * legacy JWT signed with it, so revoking it would break `ensureUser()`. That is
 * Q31, a separate piece of work — see §5.4 and `.env.local`.)
 *
 * Note what the key never changed: lifetime, claims, `sub`, `role`, per-request
 * minting, and the fact that this runs server-side only. The signature was the
 * only difference, which is what §5.4's amendment predicted when it said the
 * blast radius of this migration was one file.
 */

/** Seconds. See "why it is short-lived" above before changing this. */
const TOKEN_LIFETIME_SECONDS = 5 * 60;

/**
 * Seconds the `iat` claim is backdated. Not decoration: PostgREST rejects any
 * token whose `iat` is ahead of the database's clock — "JWT issued at future",
 * PGRST303 — and it happened in production (2026-08-15, error digest
 * 3581837676) because a Vercel lambda's clock ran a moment ahead of Supabase's.
 * Two servers we don't control will never agree to the second, so the mint has
 * to absorb the disagreement. Backdating only ever *shortens* what the token is
 * worth: `exp` is still measured from our real "now", so a fast clock on our
 * side costs the token up to 30 seconds of life, and no clock arrangement
 * grants it a second more than TOKEN_LIFETIME_SECONDS.
 */
const CLOCK_SKEW_ALLOWANCE_SECONDS = 30;

interface Signer {
  kid: string;
  key: CryptoKey | Uint8Array;
}

/**
 * Cached as a promise, not a value: `importJWK` is async, and caching the
 * settled value instead would let two concurrent requests both start an import.
 * The key material is per-process and never changes at runtime.
 */
let cachedSigner: Promise<Signer> | null = null;

function loadSigner(): Promise<Signer> {
  // Unset, unparseable or not-actually-a-private-key all throw out of here,
  // naming the variable. That IS the fail-closed behaviour: there is nothing
  // else this app is allowed to sign with, so an unusable key must stop the
  // request rather than degrade it into a token Supabase will reject anyway.
  const signingKey = supabaseJwtSigningKey();

  return importJWK(cryptographicMembersOnly(signingKey.jwk), "ES256").then((key) => ({
    kid: signingKey.kid,
    key,
  }));
}

/**
 * Hands `importJWK` the key itself and none of the bookkeeping around it.
 *
 * Not tidiness — required. `supabase gen signing-key --algorithm ES256` emits
 * `"key_ops":["sign","verify"]`, and Web Crypto refuses to import an ECDSA
 * *private* key that claims `verify` (verifying is the public half's job), so
 * passing the CLI's output through verbatim fails with "Unsupported key usage
 * for a ECDSA key". Found by importing the real generated key rather than a
 * hand-written one.
 *
 * Keeping this to an allow-list also means the same code accepts the JWK
 * however the owner obtained it — CLI output, the dashboard's displayed form,
 * or a re-export — since only these members carry the key.
 */
function cryptographicMembersOnly(jwk: Record<string, unknown>): Record<string, unknown> {
  const members = ["kty", "crv", "x", "y", "d"] as const;
  const result: Record<string, unknown> = { alg: "ES256" };
  for (const member of members) {
    if (jwk[member] !== undefined) {
      result[member] = jwk[member];
    }
  }
  return result;
}

function signer(): Promise<Signer> {
  if (cachedSigner === null) {
    cachedSigner = loadSigner().catch((error: unknown) => {
      // Don't cache a failure: a transient import error would otherwise poison
      // every subsequent request for the lifetime of the process.
      cachedSigner = null;
      throw error;
    });
  }
  return cachedSigner;
}

/**
 * @param userId `public.users.id` — already resolved and already verified to
 *   belong to the authenticated Kinde identity. This function does not check
 *   that; it signs what it is given, which is why nothing but `ensureUser()`'s
 *   return value should ever reach it.
 */
export async function mintSupabaseAccessToken(userId: string): Promise<string> {
  const signing = await signer();
  const nowSeconds = Math.floor(Date.now() / 1000);

  return await new SignJWT({ role: "authenticated" })
    // `kid` is not decoration here: it is how Supabase selects which trusted
    // public key to verify against, and a token without it is rejected even
    // when the key itself is trusted.
    .setProtectedHeader({ alg: "ES256", kid: signing.kid, typ: "JWT" })
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
    // Backdated — see CLOCK_SKEW_ALLOWANCE_SECONDS. `exp` stays anchored to
    // the real "now", so the allowance never extends the token's life.
    .setIssuedAt(nowSeconds - CLOCK_SKEW_ALLOWANCE_SECONDS)
    .setExpirationTime(nowSeconds + TOKEN_LIFETIME_SECONDS)
    .sign(signing.key);
}

/**
 * Test seam. The signer is cached per process because key material does not
 * change at runtime; a test that changes the environment needs to say so
 * explicitly rather than depend on module load order.
 *
 * @internal
 */
export function resetSupabaseTokenSignerForTests(): void {
  cachedSigner = null;
}
