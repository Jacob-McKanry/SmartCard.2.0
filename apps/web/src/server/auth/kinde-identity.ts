import "server-only";

import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload } from "jose";

import { kindeAllowedClientIds, kindeIssuerUrl } from "@/server/env";

/**
 * Step 1 of the Kinde -> Supabase bridge: turn a raw Kinde access token into a
 * set of claims we are willing to believe.
 *
 * WHY THIS EXISTS AT ALL, GIVEN THE KINDE SDK ALREADY HAS A SESSION
 *
 * On the web, `@kinde-oss/kinde-auth-nextjs` performs the authorization-code
 * exchange server-side and keeps the tokens in `HttpOnly` cookies (§5.1) — not
 * encrypted, contrary to what several comments in this app used to say; the SDK
 * stores plaintext JWTs and re-validates them against Kinde's JWKS on read, so
 * a token read back out of that session did come from Kinde. But
 * §5.3 specifies one `ensureUser` for *both* platforms, and the mobile path
 * (§5.2) is a bearer token arriving on an HTTP request from a device we do not
 * control — there, "the client says this token is fine" is not a statement
 * about anything. Verifying in one place means the web and mobile paths cannot
 * drift into having different amounts of trust in the same value, and it means
 * the web path is not silently relying on a cookie property (HttpOnly, and the
 * SDK's own on-read JWKS validation) that the mobile path does not have.
 *
 * WHAT AN ATTACK WOULD LOOK LIKE, AND WHICH CHECK STOPS IT
 *
 *  - *Forged token.* Someone hand-writes a JWT with `sub` set to another user's
 *    Kinde id. Stopped by the JWKS signature check: only Kinde holds the
 *    private key, and `createRemoteJWKSet` fetches the public keys from Kinde
 *    itself rather than trusting anything in the token.
 *  - *`alg: none` / algorithm confusion.* A token that declares no signature,
 *    or asks to be verified with a symmetric algorithm using the public key as
 *    the secret. Stopped by pinning `algorithms` to RS256 — without the pin,
 *    the token gets to choose how it is checked, which is the classic JWT
 *    vulnerability.
 *  - *Token from a different identity provider.* Stopped by the `issuer` check.
 *  - *Token from a different application in the same Kinde business.* Kinde
 *    signs every application in the business with the same keys, so signature +
 *    issuer are both satisfied by a token minted for some unrelated app.
 *    Stopped by the `azp` check below.
 *  - *Expired or not-yet-valid token.* Stopped by `jwtVerify`'s `exp`/`nbf`
 *    handling. The 5-second clock tolerance covers ordinary clock skew between
 *    Kinde's servers and ours and is far shorter than any token lifetime.
 *
 * Anything that does not pass throws. There is no "probably fine" branch: this
 * function either returns claims we are prepared to act on, or it fails.
 */

/** Raised when a token cannot be trusted. Never carries the token itself. */
export class KindeTokenVerificationError extends Error {
  /**
   * jose's machine-readable code when the JWT layer did the rejecting
   * (`ERR_JWT_EXPIRED`, `ERR_JWS_SIGNATURE_VERIFICATION_FAILED`, ...), and
   * undefined for this module's own claim checks (`azp`, `sub`). Exists so a
   * caller can tell "this session ended" apart from "this token is wrong"
   * without parsing a message string — see `getAuthenticatedContext`, which
   * treats exactly one of these codes as a normal signed-out state.
   */
  readonly code?: string;

  constructor(reason: string, options?: { cause?: unknown; code?: string }) {
    super(`Kinde token rejected: ${reason}`, { cause: options?.cause });
    this.name = "KindeTokenVerificationError";
    this.code = options?.code;
  }
}

/**
 * The verified identity of the caller, as asserted by Kinde.
 *
 * `kindeUserId` is the Kinde `sub` — the only value that links a session to a
 * `public.users` row (§5.3). The profile fields are what a *new* user's row is
 * seeded from and are otherwise unused; SmartCard is the source of truth for a
 * profile after the row exists, so a later change in Kinde does not overwrite
 * what the user has edited here.
 */
export interface KindeIdentity {
  kindeUserId: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
}

/**
 * The remote key set, created once per process.
 *
 * `createRemoteJWKSet` caches the fetched keys and re-fetches only when a token
 * presents a key id it has not seen, which is what makes Kinde's key rotation a
 * non-event for us: we never pin a key, we pin the *issuer*.
 */
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function kindeJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJwks === null) {
    cachedJwks = createRemoteJWKSet(new URL(`${kindeIssuerUrl()}/.well-known/jwks.json`));
  }
  return cachedJwks;
}

/** Reads a claim only when it is a string; anything else is treated as absent. */
function stringClaim(payload: JWTPayload, name: string): string | null {
  const value = payload[name];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export async function verifyKindeAccessToken(token: string): Promise<KindeIdentity> {
  if (typeof token !== "string" || token.trim() === "") {
    throw new KindeTokenVerificationError("no token was supplied");
  }

  const issuer = kindeIssuerUrl();

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, kindeJwks(), {
      issuer,
      // Pinned deliberately — see the algorithm-confusion note above.
      algorithms: ["RS256"],
      clockTolerance: 5,
    }));
  } catch (cause) {
    // Distinguish "the token is bad" (a client problem, 401) from "we could not
    // reach Kinde's JWKS endpoint" (our problem, 503) — but reject either way.
    // An unreachable key server must never mean "let it through": that would
    // turn an outage at Kinde into an authentication bypass here.
    if (cause instanceof joseErrors.JOSEError) {
      throw new KindeTokenVerificationError(cause.code, { cause, code: cause.code });
    }
    throw new KindeTokenVerificationError("verification failed", { cause });
  }

  // `azp` names the Kinde application the token was minted for. Kinde signs
  // every application in a business with the same keys, so this is the only
  // claim that distinguishes our two apps from anything else in the business.
  //
  // Absent `azp` is rejected rather than waved through. If a future Kinde
  // configuration stops emitting it, the correct fix is to configure an API
  // audience in Kinde and check `aud` instead — not to delete this check.
  const authorizedParty = stringClaim(payload, "azp");
  const allowedClientIds = kindeAllowedClientIds();
  if (authorizedParty === null) {
    throw new KindeTokenVerificationError(
      "token has no `azp` claim, so it cannot be attributed to one of our Kinde applications",
    );
  }
  if (!allowedClientIds.includes(authorizedParty)) {
    throw new KindeTokenVerificationError(
      "token was issued to a Kinde application that is not SmartCard Web or SmartCard Mobile",
    );
  }

  const kindeUserId = stringClaim(payload, "sub");
  if (kindeUserId === null) {
    throw new KindeTokenVerificationError("token has no `sub` claim");
  }

  return {
    kindeUserId,
    email: stringClaim(payload, "email"),
    emailVerified: payload["email_verified"] === true,
    // Kinde spells these with the OIDC standard names.
    firstName: stringClaim(payload, "given_name"),
    lastName: stringClaim(payload, "family_name"),
  };
}

/**
 * The profile claims carried by a Kinde ID token, for the ONE caller that needs
 * them: seeding a brand-new `users` row on the mobile path.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE WEB'S VERSION
 *
 * On the web, `withProfileClaimsFromSession` reads these off the Kinde SDK's
 * session, and `current-user.ts` explains at length why that is trustworthy
 * there (the SDK re-validates every token it reads out of the cookie against
 * JWKS) — and states, in the same breath, that the reasoning "does not transfer
 * to mobile", because §5.2's flow has no such cookie and must therefore "obtain
 * these claims by verifying the ID token against Kinde's JWKS the same way
 * `verifyKindeAccessToken` does, not by trusting a request body". This is that
 * function. It is the instruction being followed, not a new idea.
 *
 * THE INVARIANT THIS ENFORCES, WHICH IS THE WHOLE POINT
 *
 * `expectedSub` is the `sub` from the ALREADY-VERIFIED access token, and a
 * mismatch throws. Without it, a caller could present their own valid access
 * token alongside somebody else's valid ID token and have the second person's
 * email address written onto the first person's brand-new row. Both tokens
 * would be genuine, both would pass every signature check, and the result would
 * be an account seeded with an identity its holder does not own. `current-user.ts`
 * names this as "the invariant to preserve either way": profile claims may only
 * ever be attached to the identity that was actually verified.
 *
 * WHY `aud` RATHER THAN `azp`
 *
 * OIDC requires an ID token's `aud` to be the client id it was issued for, and
 * only requires `azp` when there are multiple audiences. The access-token check
 * above uses `azp` because that is what Kinde puts on an access token; using the
 * claim each token type actually guarantees is what keeps both checks real
 * rather than incidentally-passing. `jwtVerify`'s `audience` option accepts the
 * allow-list directly and fails closed on no match.
 */
export interface KindeProfileClaims {
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
}

export async function verifyKindeIdToken(
  token: string,
  expectedSub: string,
): Promise<KindeProfileClaims> {
  if (typeof token !== "string" || token.trim() === "") {
    throw new KindeTokenVerificationError("no ID token was supplied");
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, kindeJwks(), {
      issuer: kindeIssuerUrl(),
      audience: [...kindeAllowedClientIds()],
      // Pinned for the same reason as the access token — see the header above.
      algorithms: ["RS256"],
      clockTolerance: 5,
    }));
  } catch (cause) {
    if (cause instanceof joseErrors.JOSEError) {
      throw new KindeTokenVerificationError(cause.code, { cause, code: cause.code });
    }
    throw new KindeTokenVerificationError("ID token verification failed", { cause });
  }

  const subject = stringClaim(payload, "sub");
  if (subject === null) {
    throw new KindeTokenVerificationError("ID token has no `sub` claim");
  }
  if (subject !== expectedSub) {
    // See the header: this is the check that stops one person's profile claims
    // being attached to another person's verified identity.
    throw new KindeTokenVerificationError(
      "ID token describes a different subject than the access token it was sent with",
    );
  }

  return {
    email: stringClaim(payload, "email"),
    emailVerified: payload["email_verified"] === true,
    firstName: stringClaim(payload, "given_name"),
    lastName: stringClaim(payload, "family_name"),
  };
}
