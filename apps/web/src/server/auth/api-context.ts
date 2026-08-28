import "server-only";

import { getAuthenticatedContext, type AuthenticatedContext } from "@/server/auth/current-user";
import { ensureUser } from "@/server/auth/ensure-user";
import {
  KindeTokenVerificationError,
  verifyKindeAccessToken,
  verifyKindeIdToken,
  type KindeIdentity,
} from "@/server/auth/kinde-identity";
import { mintSupabaseAccessToken } from "@/server/auth/supabase-token";
import { rlsClient } from "@/server/supabase/rls-client";

/**
 * The auth seam for HTTP clients that are not a browser holding our cookie —
 * which today means the mobile app (§5.2), and tomorrow anything else that
 * talks to this API.
 *
 * ============================================================================
 * WHAT THIS IS AND IS NOT
 * ============================================================================
 *
 * It is NOT a second authentication system. The Kinde -> Supabase bridge is
 * five steps and this file replaces exactly ONE of them — step 1, "where does
 * the raw access token come from". Steps 2 to 5 are imported and called
 * unchanged:
 *
 *   2. `verifyKindeAccessToken` — JWKS signature, issuer, `azp`, `exp`
 *   3. `ensureUser`             — resolve/create the `public.users` row
 *   4. `mintSupabaseAccessToken`— a 5-minute token whose `sub` is that row's id
 *   5. `rlsClient`              — a client with RLS fully in force
 *
 * That is deliberate to the point of being the design. `kinde-identity.ts` says
 * §5.3 specifies one `ensureUser` for both platforms so "the web and mobile
 * paths cannot drift into having different amounts of trust in the same value".
 * A parallel implementation here would be exactly that drift. If a check needs
 * to change, it changes in one place and both callers get it.
 *
 * ============================================================================
 * WHY IT FALLS BACK TO THE COOKIE SESSION
 * ============================================================================
 *
 * With no `Authorization` header this delegates to `getAuthenticatedContext()`,
 * the web path, untouched. That is what lets ONE helper serve every route
 * handler regardless of who is calling, instead of every route growing a branch
 * — and it is why adopting this in `route-helpers.ts` cannot change how the
 * existing connect endpoints behave for the browser.
 *
 * Worth stating because it reads like a gap: a caller cannot choose the weaker
 * of the two. There is no "weaker" — both paths run the same verification, and
 * the bearer path is if anything harder to satisfy, because a cookie is
 * attached by the browser automatically while a bearer token has to be
 * deliberately presented.
 *
 * ============================================================================
 * WHY A BEARER TOKEN CHANGES THE CSRF PICTURE, AND WHY THAT IS NOT A LOOPHOLE
 * ============================================================================
 *
 * `same-origin.ts` refuses cross-site browser requests before any session is
 * read, because a cookie is "an ambient credential a third party can borrow".
 * A bearer token is not ambient: a page an attacker controls cannot read the
 * mobile app's secure storage, so there is nothing to borrow and no CSRF
 * surface. That file already allows header-less non-browser clients for exactly
 * this reason, naming "§5.2's mobile path" in its header.
 *
 * The check still runs for bearer callers and must keep running. A request that
 * DOES carry a browser's `Origin`/`Sec-Fetch-Site` signals is a browser
 * whatever else it presents, and letting an `Authorization` header switch the
 * CSRF defence off would hand any attacker page a one-header bypass.
 *
 * ============================================================================
 * WHERE THE PROFILE CLAIMS COME FROM, AND WHY THERE IS A SECOND HEADER
 * ============================================================================
 *
 * `ensureUser` needs an email to create a BRAND-NEW row (`users.email` is NOT
 * NULL), and Kinde commonly puts profile claims on the ID token rather than the
 * access token. The web reads them off the SDK's session; a bearer caller has
 * no session, so the app sends its ID token in `X-Kinde-Id-Token` and
 * `verifyKindeIdToken` verifies it against JWKS and checks its `sub` matches
 * the access token's before a single claim is believed.
 *
 * The header is OPTIONAL, and the failure mode when it is absent is good: an
 * EXISTING user never needs it (their row is found by `kinde_user_id`), and a
 * NEW user without it gets `MissingEmailClaimError` — a loud, named error that
 * says what to configure, rather than a row seeded with a null identity.
 */

/**
 * Why a result type instead of `AuthenticatedContext | null` like the web path.
 *
 * A page can only do one thing when nobody is signed in: render the gate. An
 * HTTP client can be told the difference between "your token is missing, bad or
 * expired — sign in again" and "we could not reach Kinde to check it, this is
 * our fault, retry" — and those are a 401 and a 503. Collapsing them would have
 * a mobile app sign its user out during a Kinde outage, destroying a session
 * that was never invalid. Both still refuse; only the advice differs.
 */
export type ApiAuthResult =
  | { ok: true; context: AuthenticatedContext }
  | { ok: false; status: 401 | 503 };

/** jose codes that mean the key server, not the token, was the problem. */
const JWKS_UNREACHABLE_CODES = new Set([
  "ERR_JWKS_TIMEOUT",
  "ERR_JWKS_NO_MATCHING_KEY",
  "ERR_JWKS_MULTIPLE_MATCHING_KEYS",
]);

function bearerTokenFrom(headers: Headers): string | null {
  const raw = headers.get("authorization");
  if (raw === null) return null;

  // Case-insensitive scheme, exactly one space, non-empty credential. Anything
  // else is malformed rather than absent — but it is still treated as "no
  // bearer token" so the cookie fallback can run, and a caller who sent a
  // broken header ends up at the same 401 either way.
  const match = /^Bearer[ ]+(\S+)$/i.exec(raw.trim());
  // `?? null` rather than a non-null assertion: under `noUncheckedIndexedAccess`
  // a matched group is still `string | undefined` to the compiler, and the two
  // absent-ness values must not both be in play downstream.
  return match?.[1] ?? null;
}

export async function getApiAuthenticatedContext(headers: Headers): Promise<ApiAuthResult> {
  const bearer = bearerTokenFrom(headers);

  if (bearer === null) {
    // No bearer token: this is a browser using the cookie session, so run the
    // web path exactly as it has always run.
    const context = await getAuthenticatedContext();
    return context === null ? { ok: false, status: 401 } : { ok: true, context };
  }

  let identity: KindeIdentity;
  try {
    identity = await verifyKindeAccessToken(bearer);
  } catch (error) {
    return { ok: false, status: statusForTokenFailure(error) };
  }

  // Only ever consulted to fill a gap, and only for a new row — same condition
  // the web path applies before reading the session's claims.
  if (identity.email === null) {
    const rawIdToken = headers.get("x-kinde-id-token");
    if (rawIdToken !== null && rawIdToken.trim() !== "") {
      try {
        const claims = await verifyKindeIdToken(rawIdToken, identity.kindeUserId);
        identity = {
          ...identity,
          email: claims.email ?? identity.email,
          emailVerified: claims.emailVerified || identity.emailVerified,
          firstName: claims.firstName ?? identity.firstName,
          lastName: claims.lastName ?? identity.lastName,
        };
      } catch (error) {
        // A supplied-but-unverifiable ID token is refused rather than ignored.
        // Ignoring it would mean a caller who sent a forged or mismatched token
        // gets the same treatment as one who sent none — which quietly turns a
        // detected attack into a normal request.
        return { ok: false, status: statusForTokenFailure(error) };
      }
    }
  }

  const userId = await ensureUser(identity);
  const supabaseAccessToken = await mintSupabaseAccessToken(userId);

  return {
    ok: true,
    context: {
      userId,
      kindeUserId: identity.kindeUserId,
      supabase: rlsClient(supabaseAccessToken),
    },
  };
}

/**
 * 503 only when Kinde's key server was the thing that failed; 401 for every
 * statement about the token itself, expiry included.
 *
 * Note what is NOT here: there is no branch that returns a context. An
 * unreachable JWKS endpoint must never mean "let it through" — that would turn
 * an outage at Kinde into an authentication bypass, which `kinde-identity.ts`
 * calls out in as many words.
 */
function statusForTokenFailure(error: unknown): 401 | 503 {
  if (error instanceof KindeTokenVerificationError && error.code !== undefined) {
    return JWKS_UNREACHABLE_CODES.has(error.code) ? 503 : 401;
  }
  // A non-JOSE throw is this module's own claim check (`azp`, `sub`) or
  // something unrecognised. Both are statements about the token.
  return 401;
}
