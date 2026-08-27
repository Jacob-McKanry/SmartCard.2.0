import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KindeTokenVerificationError } from "./kinde-identity";

/**
 * The mobile auth seam (§5.2). These tests are about the decisions this module
 * makes — which credential it reads, what it refuses, and what status it
 * refuses with — not about JWKS mechanics, which `kinde-identity.ts` owns and
 * documents. Collaborators are mocked at their module boundaries.
 *
 * Three properties are worth more than the rest, and each has a test whose
 * failure would be a real security regression rather than a broken feature:
 *
 *  1. A bad token NEVER yields a context. There is no branch anywhere below
 *     that returns a caller on a verification failure, including when the
 *     failure is "we could not reach Kinde" — an unreachable key server must
 *     not become an authentication bypass.
 *  2. A supplied-but-unverifiable ID token is REFUSED, not ignored. Ignoring it
 *     would give a caller who sent a forged token the same treatment as one who
 *     sent none, quietly turning a detected attack into a normal request.
 *  3. Profile claims can only ever come from the identity that was verified.
 *     The `sub` equality check lives in `verifyKindeIdToken`, and this suite
 *     asserts this module actually passes the access token's subject to it —
 *     a check that is never called is not a check.
 */

const { getAuthenticatedContext, verifyKindeAccessToken, verifyKindeIdToken, ensureUser, mintSupabaseAccessToken, rlsClient } =
  vi.hoisted(() => ({
    getAuthenticatedContext: vi.fn(),
    verifyKindeAccessToken: vi.fn(),
    verifyKindeIdToken: vi.fn(),
    ensureUser: vi.fn(() => Promise.resolve("11111111-2222-3333-4444-555555555555")),
    mintSupabaseAccessToken: vi.fn(() => Promise.resolve("minted-token")),
    rlsClient: vi.fn(() => ({ marker: "rls-client" })),
  }));

vi.mock("@/server/auth/current-user", () => ({ getAuthenticatedContext }));
vi.mock("@/server/auth/kinde-identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./kinde-identity")>();
  return { ...actual, verifyKindeAccessToken, verifyKindeIdToken };
});
vi.mock("@/server/auth/ensure-user", () => ({ ensureUser }));
vi.mock("@/server/auth/supabase-token", () => ({ mintSupabaseAccessToken }));
vi.mock("@/server/supabase/rls-client", () => ({ rlsClient }));

const { getApiAuthenticatedContext } = await import("./api-context");

const KINDE_SUB = "kp_abc123";
const IDENTITY = {
  kindeUserId: KINDE_SUB,
  email: "someone@example.com",
  emailVerified: true,
  firstName: "Sam",
  lastName: "Rivera",
};

const headers = (init: Record<string, string> = {}) => new Headers(init);
const bearer = (token = "a-real-looking-token") => headers({ authorization: `Bearer ${token}` });

beforeEach(() => {
  vi.clearAllMocks();
  verifyKindeAccessToken.mockResolvedValue(IDENTITY);
  ensureUser.mockResolvedValue("11111111-2222-3333-4444-555555555555");
  mintSupabaseAccessToken.mockResolvedValue("minted-token");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("choosing which credential to read", () => {
  it("uses the bearer token when one is present, never the cookie session", async () => {
    const result = await getApiAuthenticatedContext(bearer("mobile-token"));

    expect(result).toMatchObject({ ok: true, context: { kindeUserId: KINDE_SUB } });
    expect(verifyKindeAccessToken).toHaveBeenCalledWith("mobile-token");
    expect(getAuthenticatedContext).not.toHaveBeenCalled();
  });

  it("falls back to the cookie session when there is no Authorization header", async () => {
    getAuthenticatedContext.mockResolvedValue({
      userId: "web-user",
      kindeUserId: "web-kinde",
      supabase: { marker: "web" },
    });

    const result = await getApiAuthenticatedContext(headers());

    expect(result).toMatchObject({ ok: true, context: { userId: "web-user" } });
    expect(verifyKindeAccessToken).not.toHaveBeenCalled();
  });

  it("401s when there is neither a bearer token nor a cookie session", async () => {
    getAuthenticatedContext.mockResolvedValue(null);

    await expect(getApiAuthenticatedContext(headers())).resolves.toEqual({ ok: false, status: 401 });
  });

  it("accepts the scheme case-insensitively, as RFC 7235 requires", async () => {
    const result = await getApiAuthenticatedContext(headers({ authorization: "bearer lowercase" }));

    expect(result).toMatchObject({ ok: true });
    expect(verifyKindeAccessToken).toHaveBeenCalledWith("lowercase");
  });

  it("treats a malformed Authorization header as no bearer token at all", async () => {
    getAuthenticatedContext.mockResolvedValue(null);

    // Not "Bearer <token>": a bare value, another scheme, and an empty credential.
    for (const value of ["just-a-token", "Basic dXNlcjpwYXNz", "Bearer "]) {
      const result = await getApiAuthenticatedContext(headers({ authorization: value }));
      expect(result).toEqual({ ok: false, status: 401 });
    }
    expect(verifyKindeAccessToken).not.toHaveBeenCalled();
  });
});

describe("a token that does not verify never produces a caller", () => {
  it("401s a forged, wrong-app or wrong-issuer token", async () => {
    verifyKindeAccessToken.mockRejectedValue(
      new KindeTokenVerificationError("signature check failed", {
        code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
      }),
    );

    await expect(getApiAuthenticatedContext(bearer())).resolves.toEqual({ ok: false, status: 401 });
    expect(ensureUser).not.toHaveBeenCalled();
    expect(mintSupabaseAccessToken).not.toHaveBeenCalled();
  });

  it("401s an expired token", async () => {
    verifyKindeAccessToken.mockRejectedValue(
      new KindeTokenVerificationError("expired", { code: "ERR_JWT_EXPIRED" }),
    );

    await expect(getApiAuthenticatedContext(bearer())).resolves.toEqual({ ok: false, status: 401 });
  });

  it("401s this module's own claim checks, which carry no jose code", async () => {
    verifyKindeAccessToken.mockRejectedValue(
      new KindeTokenVerificationError("token has no `azp` claim"),
    );

    await expect(getApiAuthenticatedContext(bearer())).resolves.toEqual({ ok: false, status: 401 });
  });

  /**
   * The one that would be a genuine bypass if it regressed. An unreachable key
   * server is OUR failure and is reported as one — but it still refuses, and it
   * still never reaches `ensureUser`.
   */
  it("503s an unreachable JWKS endpoint, and still refuses", async () => {
    verifyKindeAccessToken.mockRejectedValue(
      new KindeTokenVerificationError("timeout", { code: "ERR_JWKS_TIMEOUT" }),
    );

    const result = await getApiAuthenticatedContext(bearer());

    expect(result).toEqual({ ok: false, status: 503 });
    expect(ensureUser).not.toHaveBeenCalled();
    expect(mintSupabaseAccessToken).not.toHaveBeenCalled();
  });
});

describe("profile claims from the ID token", () => {
  const noEmail = { ...IDENTITY, email: null, firstName: null, lastName: null };

  it("is not consulted at all when the access token already carries an email", async () => {
    await getApiAuthenticatedContext(
      headers({ authorization: "Bearer t", "x-kinde-id-token": "id-token" }),
    );

    expect(verifyKindeIdToken).not.toHaveBeenCalled();
  });

  it("verifies the ID token against the ACCESS token's subject, then seeds from it", async () => {
    verifyKindeAccessToken.mockResolvedValue(noEmail);
    verifyKindeIdToken.mockResolvedValue({
      email: "new@example.com",
      emailVerified: true,
      firstName: "Ada",
      lastName: "Lovelace",
    });

    await getApiAuthenticatedContext(
      headers({ authorization: "Bearer t", "x-kinde-id-token": "id-token" }),
    );

    // The second argument is the invariant: claims may only be attached to the
    // identity that was actually verified.
    expect(verifyKindeIdToken).toHaveBeenCalledWith("id-token", KINDE_SUB);
    expect(ensureUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@example.com", firstName: "Ada" }),
    );
  });

  it("REFUSES a supplied ID token that does not verify, rather than ignoring it", async () => {
    verifyKindeAccessToken.mockResolvedValue(noEmail);
    verifyKindeIdToken.mockRejectedValue(
      new KindeTokenVerificationError(
        "ID token describes a different subject than the access token it was sent with",
      ),
    );

    const result = await getApiAuthenticatedContext(
      headers({ authorization: "Bearer t", "x-kinde-id-token": "someone-elses" }),
    );

    expect(result).toEqual({ ok: false, status: 401 });
    expect(ensureUser).not.toHaveBeenCalled();
  });

  it("proceeds without it when it is absent, leaving ensureUser to complain", async () => {
    verifyKindeAccessToken.mockResolvedValue(noEmail);

    await getApiAuthenticatedContext(bearer());

    expect(verifyKindeIdToken).not.toHaveBeenCalled();
    expect(ensureUser).toHaveBeenCalledWith(expect.objectContaining({ email: null }));
  });
});

describe("the chain it hands off to", () => {
  it("mints a Supabase token for the resolved row and binds the client to it", async () => {
    ensureUser.mockResolvedValue("row-id");

    const result = await getApiAuthenticatedContext(bearer());

    expect(mintSupabaseAccessToken).toHaveBeenCalledWith("row-id", {
      email: "someone@example.com",
      emailVerified: true,
    });
    expect(rlsClient).toHaveBeenCalledWith("minted-token");
    expect(result).toMatchObject({ ok: true, context: { userId: "row-id" } });
  });
});

/**
 * THE EMAIL CLAIMS THE GUEST-LIST CLAIM GATE RUNS ON (§3.2).
 *
 * `public.claim_event_import` reads `email` and `email_verified` out of the
 * minted Supabase token, because `public.users` cannot answer either question
 * honestly — `ensureUser` writes both columns on INSERT and never updates them.
 * So what this file hands to `mintSupabaseAccessToken` IS the gate's input, and
 * every assertion below is about that value rather than about a response shape.
 *
 * The direction of every failure is the same: `emailVerified: false`. That does
 * not refuse anybody outright — the grandfather clause (§3.2.1) still admits
 * accounts predating the import — it costs a genuinely-verified NEW signup a
 * claim. False negatives are visible and annoying; a false positive lets
 * somebody read a stranger's phone number.
 */
describe("the email claims that reach the minted token", () => {
  const unverified = { ...IDENTITY, emailVerified: false };

  it("carries them onto the context as well as into the token", async () => {
    const result = await getApiAuthenticatedContext(bearer());

    expect(result).toMatchObject({
      ok: true,
      context: { email: "someone@example.com", emailVerified: true },
    });
  });

  it("consults the ID token when the access token has an email but no verification claim", async () => {
    // The widened guard. Kinde puts `email_verified` in the ID token on the
    // default configuration, so an access token with an email is no longer a
    // complete identity — it was, back when these claims only ever seeded a new
    // `users` row.
    verifyKindeAccessToken.mockResolvedValue(unverified);
    verifyKindeIdToken.mockResolvedValue({
      email: "someone@example.com",
      emailVerified: true,
      firstName: "Sam",
      lastName: "Rivera",
    });

    await getApiAuthenticatedContext(
      headers({ authorization: "Bearer t", "x-kinde-id-token": "id-token" }),
    );

    expect(verifyKindeIdToken).toHaveBeenCalled();
    expect(mintSupabaseAccessToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ emailVerified: true }),
    );
  });

  it("does NOT let a bad ID token 401 a request that already has an email", async () => {
    // The split that keeps the widened guard from becoming a regression. This
    // token was only ever going to UPGRADE `emailVerified`; a stale ID token
    // beside a fresh access token is an ordinary client state, because
    // `@kinde/expo` refreshes the two independently. Before the guard widened,
    // this request never read the ID token at all and simply succeeded.
    verifyKindeAccessToken.mockResolvedValue(unverified);
    verifyKindeIdToken.mockRejectedValue(new KindeTokenVerificationError("stale"));

    const result = await getApiAuthenticatedContext(
      headers({ authorization: "Bearer t", "x-kinde-id-token": "stale-token" }),
    );

    expect(result).toMatchObject({ ok: true });
  });

  it("degrades that failure to unverified rather than to verified", async () => {
    // The half of the previous test that actually matters. Succeeding is only
    // correct if it grants nothing — a swallowed error must not leave the gate
    // reading `true`.
    verifyKindeAccessToken.mockResolvedValue(unverified);
    verifyKindeIdToken.mockRejectedValue(new KindeTokenVerificationError("stale"));

    await getApiAuthenticatedContext(
      headers({ authorization: "Bearer t", "x-kinde-id-token": "stale-token" }),
    );

    expect(mintSupabaseAccessToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ emailVerified: false }),
    );
  });

  it("STILL refuses a bad ID token when there is no email without it", async () => {
    // Unchanged, and the reason the split exists rather than a blanket swallow.
    // Here the ID token is load-bearing: `ensureUser` needs it to seed a new
    // row, so a caller who sent a forged or mismatched one must not get the
    // same treatment as one who sent none.
    verifyKindeAccessToken.mockResolvedValue({ ...IDENTITY, email: null, emailVerified: false });
    verifyKindeIdToken.mockRejectedValue(new KindeTokenVerificationError("forged"));

    const result = await getApiAuthenticatedContext(
      headers({ authorization: "Bearer t", "x-kinde-id-token": "someone-elses" }),
    );

    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(mintSupabaseAccessToken).not.toHaveBeenCalled();
  });

  it("sends a null email rather than inventing one when no token carried it", async () => {
    verifyKindeAccessToken.mockResolvedValue({ ...IDENTITY, email: null, emailVerified: false });

    await getApiAuthenticatedContext(bearer());

    expect(mintSupabaseAccessToken).toHaveBeenCalledWith(expect.any(String), {
      email: null,
      emailVerified: false,
    });
  });
});
