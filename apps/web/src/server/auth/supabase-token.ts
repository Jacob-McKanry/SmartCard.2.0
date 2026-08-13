import "server-only";

import { importJWK, SignJWT } from "jose";

import { supabaseJwtSecret, supabaseJwtSigningKey, supabaseUrl } from "@/server/env";

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
 * WHAT KEY IT IS SIGNED WITH, AND WHY THAT CHANGED (Q27, second §5.4 amendment)
 *
 * Originally HS256 with the project's shared JWT secret. That secret turned out
 * to be the project's *previous* key: this project has already rotated to
 * asymmetric JWT signing keys, and Supabase keeps a previous key alive only
 * long enough for outstanding tokens to expire. Signing with a key on its way
 * out means an outage that arrives without warning and hits every user at once.
 *
 * The replacement is the mechanism Supabase documents for exactly this case —
 * "How to create (mint) JWTs if access to the private key or shared secret is
 * not possible?": generate an ES256 (P-256) key ourselves, import it into the
 * project's JWT Signing Keys, rotate it in, and sign with it. Supabase's own
 * current key cannot be used by us at all, because Supabase holds its private
 * half and will not export it; only Supabase Auth can sign with that one.
 *
 * Two properties of the ES256 path worth stating, because they are the reason
 * it is better rather than merely newer:
 *
 *  - **Verification no longer needs the secret.** The project verifies with the
 *    public half, published at `/auth/v1/.well-known/jwks.json`. The private
 *    half is held by this server (and by Supabase, since the dashboard import
 *    takes a private JWK — there is no verify-only import).
 *  - **Revocation is a dashboard action, not a redeploy.** If this key ever
 *    leaks, the owner revokes it in the signing-keys UI and every token signed
 *    with it stops being accepted immediately, with no code change.
 *
 * THE HS256 BRANCH BELOW IS TRANSITIONAL AND SHOULD BE DELETED
 *
 * Importing and rotating a signing key is a manual dashboard step (or a
 * Management API call) that no code in this repo can perform. Until it is done,
 * a token signed with the new key would be rejected — Supabase accepts
 * signatures from the in-use and previously-used keys, not from a standby one.
 * So the mechanism is chosen by whether `SUPABASE_JWT_SIGNING_KEY` is set,
 * which mirrors Supabase's own zero-downtime ordering (import as standby ->
 * rotate -> switch the consumer -> revoke the old key). The legacy branch warns
 * once per process rather than staying silent, because the failure this whole
 * change exists to prevent is precisely "nobody noticed we were still on the
 * deprecated key". **Once the rotation is confirmed in front of real data,
 * delete the HS256 branch and make `SUPABASE_JWT_SIGNING_KEY` required.**
 *
 * Note what does *not* change with the key: lifetime, claims, `sub`, `role`,
 * per-request minting, and the fact that this runs server-side only. The
 * signature is the only difference, which is what §5.4's amendment predicted
 * when it said the blast radius of this migration was one file.
 */

/** Seconds. See "why it is short-lived" above before changing this. */
const TOKEN_LIFETIME_SECONDS = 5 * 60;

type Signer =
  | { alg: "ES256"; kid: string; key: CryptoKey | Uint8Array }
  | { alg: "HS256"; kid: null; key: Uint8Array };

/**
 * Cached as a promise, not a value: `importJWK` is async, and caching the
 * settled value instead would let two concurrent requests both start an import.
 * The key material is per-process and never changes at runtime.
 */
let cachedSigner: Promise<Signer> | null = null;

function loadSigner(): Promise<Signer> {
  const signingKey = supabaseJwtSigningKey();

  if (signingKey === null) {
    // Resolve the secret first: with neither key configured the right outcome
    // is `env.ts`'s named, fail-closed error, not a warning about a fallback
    // that is not actually available.
    const secret = new TextEncoder().encode(supabaseJwtSecret());
    warnOnceAboutLegacySecret();
    return Promise.resolve({ alg: "HS256", kid: null, key: secret });
  }

  return importJWK(cryptographicMembersOnly(signingKey.jwk), "ES256").then((key) => ({
    alg: "ES256" as const,
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

let legacyWarningEmitted = false;

function warnOnceAboutLegacySecret(): void {
  if (legacyWarningEmitted) {
    return;
  }
  legacyWarningEmitted = true;
  console.warn(
    "[auth] Signing Supabase access tokens with the LEGACY shared JWT secret (HS256). " +
      "This project has already rotated to asymmetric JWT signing keys, so this secret is the " +
      "project's PREVIOUS key and Supabase may revoke it without warning — at which point every " +
      "request fails at once. Fix: import the ES256 key into Supabase (Project Settings -> JWT " +
      "Keys -> add a standby key, then Rotate), then set SUPABASE_JWT_SIGNING_KEY. See .env.local " +
      "and architecture §5.4 (Q27).",
  );
}

/**
 * @param userId `public.users.id` — already resolved and already verified to
 *   belong to the authenticated Kinde identity. This function does not check
 *   that; it signs what it is given, which is why nothing but `ensureUser()`'s
 *   return value should ever reach it.
 */
export async function mintSupabaseAccessToken(userId: string): Promise<string> {
  const signing = await signer();

  return await new SignJWT({ role: "authenticated" })
    .setProtectedHeader(
      signing.alg === "ES256"
        ? // `kid` is not decoration here: it is how Supabase selects which
          // trusted public key to verify against, and a token without it is
          // rejected even when the key itself is trusted.
          { alg: "ES256", kid: signing.kid, typ: "JWT" }
        : { alg: "HS256", typ: "JWT" },
    )
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
  legacyWarningEmitted = false;
}
