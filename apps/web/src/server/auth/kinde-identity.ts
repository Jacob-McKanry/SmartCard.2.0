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
 * exchange server-side and keeps the tokens in encrypted HttpOnly cookies
 * (§5.1), so a token read back out of that session did come from Kinde. But
 * §5.3 specifies one `ensureUser` for *both* platforms, and the mobile path
 * (§5.2) is a bearer token arriving on an HTTP request from a device we do not
 * control — there, "the client says this token is fine" is not a statement
 * about anything. Verifying in one place means the web and mobile paths cannot
 * drift into having different amounts of trust in the same value, and it means
 * the web path is not silently relying on a property (cookie encryption) that
 * the mobile path does not have.
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
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Kinde token rejected: ${reason}`, options);
    this.name = "KindeTokenVerificationError";
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
      throw new KindeTokenVerificationError(cause.code, { cause });
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
