import { createLocalJWKSet, decodeJwt, exportJWK, generateKeyPair, jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mintSupabaseAccessToken, resetSupabaseTokenSignerForTests } from "./supabase-token";

/**
 * The one credential in this system that grants direct database access as a
 * specific person (§5.4). These tests exist because the signing *mechanism*
 * changed under Q27 — from the project's legacy shared secret to an ES256 key
 * we own and imported — and the whole risk of a change like that is that the
 * signature gets fixed while something about the claims quietly does not
 * survive the move. Each property asserted below is one an RLS policy or the
 * API gateway depends on:
 *
 *  - `sub` is what `auth.uid()` casts to uuid; every policy in the schema
 *    compares against it. A wrong or missing `sub` is not a failed login, it is
 *    a query evaluated as somebody else (or an error, per the §5.4 amendment).
 *  - `role: authenticated` picks the Postgres role. Without it the caller lands
 *    on `anon`, which holds no grant anywhere in this schema (§3.6).
 *  - The 5-minute lifetime is the only thing bounding the damage of a leaked
 *    token — there is no revocation list for an individual token.
 *  - `kid` is how Supabase selects the public key to verify with. A token
 *    without it is rejected even when the key itself is trusted, so its absence
 *    would look like "auth is broken" rather than "the header is wrong".
 *
 * Signature verification here uses the *public* half only, the same way the
 * Supabase project does via its JWKS endpoint — which is the point of moving to
 * an asymmetric key, and is not something the HS256 arrangement could be tested
 * for at all.
 */

const USER_ID = "0f687466-3f44-4b0d-807e-0e2bfbcad9f8";
/**
 * The default for tests that are about signing rather than about email claims.
 * Deliberately the *unverified* shape, so a test that starts caring about the
 * gate has to say so out loud rather than inherit a permissive fixture.
 */
const UNVERIFIED = { email: null, emailVerified: false } as const;
// A syntactically real but fictional project ref. Deliberately NOT the live
// project's: every assertion below is relative to this constant, so the tests
// prove the issuer is derived from `SUPABASE_URL` without the repo having to
// name the production project in a fixture (2026-08 security audit, step 1).
const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.SUPABASE_URL = SUPABASE_URL;
  delete process.env.SUPABASE_JWT_SIGNING_KEY;
  resetSupabaseTokenSignerForTests();
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetSupabaseTokenSignerForTests();
  vi.restoreAllMocks();
});

/** The token's claims, read without verifying — these tests assert content, not signatures. */
function claimsOf(token: string): Record<string, unknown> {
  return decodeJwt(token) as Record<string, unknown>;
}

/** Stands in for `supabase gen signing-key --algorithm ES256` + the dashboard import. */
async function importedSigningKey(kid = "805e8694-c88a-4d20-a619-0b988f153fa0") {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: "ES256", use: "sig" };
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" };
  return { privateJwk, publicJwk, kid };
}

describe("mintSupabaseAccessToken — ES256 signing key (the current mechanism)", () => {
  it("mints a token the project can verify with the public half alone", async () => {
    const { privateJwk, publicJwk, kid } = await importedSigningKey();
    process.env.SUPABASE_JWT_SIGNING_KEY = JSON.stringify(privateJwk);

    const token = await mintSupabaseAccessToken(USER_ID, UNVERIFIED);

    // Exactly what Supabase does: fetch the JWKS, match on `kid`, verify.
    const jwks = createLocalJWKSet({ keys: [publicJwk] });
    const { payload, protectedHeader } = await jwtVerify(token, jwks, {
      audience: "authenticated",
      issuer: `${SUPABASE_URL}/auth/v1`,
    });

    expect(protectedHeader.alg).toBe("ES256");
    expect(protectedHeader.kid).toBe(kid);
    expect(protectedHeader.typ).toBe("JWT");
    expect(payload.sub).toBe(USER_ID);
    expect(payload.role).toBe("authenticated");
  });

  it("still expires five minutes from now, with `iat` backdated for clock skew", async () => {
    const { privateJwk } = await importedSigningKey();
    process.env.SUPABASE_JWT_SIGNING_KEY = JSON.stringify(privateJwk);

    const before = Math.floor(Date.now() / 1000);
    const { exp, iat } = claimsOf(await mintSupabaseAccessToken(USER_ID, UNVERIFIED));
    const after = Math.ceil(Date.now() / 1000);

    // The lifetime bound is measured from the real "now": five minutes, not a
    // second more. Regression guard for the skew fix — backdating `iat` must
    // never have the side effect of pushing `exp` out with it.
    expect(Number(exp)).toBeGreaterThanOrEqual(before + 300);
    expect(Number(exp)).toBeLessThanOrEqual(after + 300);

    // `iat` sits 30 seconds in the past so a database clock running slightly
    // ahead of ours does not reject the token as "issued at future" (PGRST303,
    // seen in production 2026-08-15).
    expect(Number(iat)).toBeGreaterThanOrEqual(before - 30);
    expect(Number(iat)).toBeLessThanOrEqual(after - 30);
  });

  it("grants `authenticated` and never a higher role, whatever it is handed", async () => {
    const { privateJwk } = await importedSigningKey();
    process.env.SUPABASE_JWT_SIGNING_KEY = JSON.stringify(privateJwk);

    // The user id is data, not configuration — a value shaped like a claim
    // injection must end up in `sub` as a plain string, not alter the token.
    const payload = claimsOf(await mintSupabaseAccessToken('{"role":"service_role"}', UNVERIFIED));

    expect(payload.role).toBe("authenticated");
    expect(payload.sub).toBe('{"role":"service_role"}');
  });

  it("accepts the CLI's output verbatim, `key_ops` and all", async () => {
    // Regression: `supabase gen signing-key --algorithm ES256` emits
    // `"key_ops":["sign","verify"]`, which Web Crypto rejects for an ECDSA
    // private key ("Unsupported key usage for a ECDSA key"). The first version
    // of this code passed the JWK straight through and failed on the real key
    // while passing against a hand-built one — so the shape the owner will
    // actually paste is the shape asserted here.
    const { privateJwk, publicJwk } = await importedSigningKey();
    process.env.SUPABASE_JWT_SIGNING_KEY = JSON.stringify({
      ...privateJwk,
      key_ops: ["sign", "verify"],
      ext: true,
    });

    const token = await mintSupabaseAccessToken(USER_ID, UNVERIFIED);

    await expect(jwtVerify(token, createLocalJWKSet({ keys: [publicJwk] }))).resolves.toBeTruthy();
  });

  it("is not verifiable with a different key, so a token cannot be forged without ours", async () => {
    const { privateJwk } = await importedSigningKey();
    const other = await importedSigningKey();
    process.env.SUPABASE_JWT_SIGNING_KEY = JSON.stringify(privateJwk);

    const token = await mintSupabaseAccessToken(USER_ID, UNVERIFIED);
    const wrongKeySet = createLocalJWKSet({ keys: [other.publicJwk] });

    await expect(jwtVerify(token, wrongKeySet)).rejects.toThrow();
  });
});

describe("mintSupabaseAccessToken — misconfiguration fails closed rather than falling back", () => {
  /**
   * The accident this guards against used to be a mistyped or half-pasted
   * signing key silently demoting the app onto the deprecated shared secret.
   * That fallback was deleted on 2026-08-14, so the guarantee is now stronger
   * and simpler: there is exactly one key this app can sign with, and anything
   * wrong with it stops the request at the source with a legible error rather
   * than producing a token Supabase would reject with an opaque 401.
   */
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["not JSON at all", "-----BEGIN PRIVATE KEY-----"],
    ["a JSON array instead of one key", '[{"kty":"EC","kid":"a","d":"x"}]'],
    ["no kid", '{"kty":"EC","crv":"P-256","d":"x","x":"y","y":"z"}'],
    ["a public key with no private part", '{"kty":"EC","kid":"a","crv":"P-256","x":"y","y":"z"}'],
    ["an algorithm this app does not sign", '{"kty":"oct","kid":"a","alg":"HS256","d":"x"}'],
  ];

  it.each(cases)("refuses %s", async (_label, value) => {
    process.env.SUPABASE_JWT_SIGNING_KEY = value;

    await expect(mintSupabaseAccessToken(USER_ID, UNVERIFIED)).rejects.toThrow();
  });

  it("fails closed with a named variable when no signing key is configured at all", async () => {
    // `beforeEach` already deleted it. Unset is the one misconfiguration a
    // fresh deployment is most likely to hit, so the error has to say which
    // variable is missing rather than surface as a signing failure.
    await expect(mintSupabaseAccessToken(USER_ID, UNVERIFIED)).rejects.toThrow(/SUPABASE_JWT_SIGNING_KEY/);
  });

  it("does not cache the failure, so fixing the variable fixes the app", async () => {
    process.env.SUPABASE_JWT_SIGNING_KEY = "{ broken";
    await expect(mintSupabaseAccessToken(USER_ID, UNVERIFIED)).rejects.toThrow();

    const { privateJwk, publicJwk } = await importedSigningKey();
    process.env.SUPABASE_JWT_SIGNING_KEY = JSON.stringify(privateJwk);
    resetSupabaseTokenSignerForTests();

    const token = await mintSupabaseAccessToken(USER_ID, UNVERIFIED);
    await expect(jwtVerify(token, createLocalJWKSet({ keys: [publicJwk] }))).resolves.toBeTruthy();
  });
});

/**
 * THE CLAIMS THE GUEST-LIST CLAIM GATE READS (§3.2 of the import design).
 *
 * `public.claim_event_import` answers two questions from this token and cannot
 * answer either from `public.users`: which address is this caller's, and did an
 * identity provider prove they control it. `ensureUser` writes `email` and
 * `email_verified` on INSERT and never updates them, so both columns are frozen
 * at signup — the design says in as many words to read the live token claim.
 *
 * That makes the shape of these two claims a security interface, not a detail.
 * Each test below pins one property the SQL will be written against.
 */
describe("mintSupabaseAccessToken — the email claims", () => {
  async function claimsWith(claims: { email: string | null; emailVerified: boolean }) {
    const { privateJwk } = await importedSigningKey();
    process.env.SUPABASE_JWT_SIGNING_KEY = JSON.stringify(privateJwk);
    return claimsOf(await mintSupabaseAccessToken(USER_ID, claims));
  }

  it("carries the address and the verification flag", async () => {
    const payload = await claimsWith({ email: "kim@example.com", emailVerified: true });

    expect(payload.email).toBe("kim@example.com");
    expect(payload.email_verified).toBe(true);
  });

  it("writes `email_verified` as a real boolean, not a string", async () => {
    // The SQL gate will read this as `(claims ->> 'email_verified')::boolean`.
    // A JSON string `"false"` casts to `false` in Postgres, but a string
    // `"true"` and a boolean `true` are the same to that cast while being
    // different to every JS check on the way here — so the type is pinned
    // rather than left to whatever `SignJWT` does with a truthy value.
    const payload = await claimsWith({ email: "kim@example.com", emailVerified: false });

    expect(payload.email_verified).toBe(false);
    expect(typeof payload.email_verified).toBe("boolean");
  });

  it("omits `email` entirely rather than sending null, so the RPC sees one absent-ness", async () => {
    const payload = await claimsWith({ email: null, emailVerified: false });

    expect("email" in payload).toBe(false);
    // Still says no out loud, so a decoded token distinguishes "we said no"
    // from "we forgot to say".
    expect(payload.email_verified).toBe(false);
  });

  it("never lets the email claim displace `sub` or `role`", async () => {
    // The claims object is spread into `SignJWT`'s payload, so a future edit
    // that widened it could shadow the two claims every RLS policy in the
    // schema depends on. `sub` and `role` are set by the builder AFTER the
    // payload, but that ordering is an implementation detail worth pinning.
    const payload = await claimsWith({ email: "kim@example.com", emailVerified: true });

    expect(payload.sub).toBe(USER_ID);
    expect(payload.role).toBe("authenticated");
  });

  it("keeps the five-minute lifetime, which the extra claims must not change", async () => {
    const before = Math.floor(Date.now() / 1000);
    const payload = await claimsWith({ email: "kim@example.com", emailVerified: true });

    expect(Number(payload.exp)).toBeGreaterThanOrEqual(before + 300);
    expect(Number(payload.exp)).toBeLessThanOrEqual(before + 301);
  });
});
