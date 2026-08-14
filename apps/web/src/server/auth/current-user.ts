import "server-only";

import { cache } from "react";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureUser } from "@/server/auth/ensure-user";
import { verifyKindeAccessToken, type KindeIdentity } from "@/server/auth/kinde-identity";
import { mintSupabaseAccessToken } from "@/server/auth/supabase-token";
import { rlsClient } from "@/server/supabase/rls-client";

/**
 * The web app's entry point into the auth bridge: "this request has a Kinde
 * session" -> "here is a Supabase client whose queries see `auth.uid()` resolve
 * to the right `public.users.id`".
 *
 * The whole chain, in order, with the reason each link exists:
 *
 *   1. Read the Kinde session. Confidential client, code exchanged server-side,
 *      tokens in encrypted HttpOnly cookies (§5.1) — so browser JavaScript,
 *      including anything injected by an XSS bug, cannot read the token.
 *   2. Verify that token against Kinde's JWKS (`verifyKindeAccessToken`).
 *   3. Resolve it to a `public.users` row (`ensureUser`), with the service role,
 *      because the client must not be able to pick its own `kinde_user_id`.
 *   4. Mint a 5-minute Supabase token whose `sub` is that row's id.
 *   5. Hand back a client bound to that token, with RLS fully in force.
 *
 * Everything after step 5 is ordinary application code that cannot see rows the
 * policies forbid, which is the entire point of doing steps 1-4.
 */

export interface AuthenticatedContext {
  /** `public.users.id` — the value `auth.uid()` resolves to for this request. */
  userId: string;
  /** The Kinde `sub` this resolved from. Useful in logs; never a query key outside `ensureUser`. */
  kindeUserId: string;
  /** RLS-bound Supabase client. Never the service role. */
  supabase: SupabaseClient;
}

/**
 * Returns null when there is no signed-in user — that is a normal state for a
 * page, not an error. Anything else that goes wrong throws, because a partial
 * or unverifiable session must never degrade into "treat them as a guest and
 * carry on": on this codepath, silence is indistinguishable from a bypass.
 *
 * Wrapped in React's `cache()` so the (app) route group's layout (the auth
 * gate) and the page it renders can each call this and only pay for one
 * verify-and-mint per request, not two — `cache()` memoizes by identical
 * arguments for the lifetime of a single render pass, which this function's
 * zero arguments make automatic. Never reaches across requests: a fresh cache
 * is created per request by the framework, which is exactly what a function
 * whose result depends on "who is calling right now" needs.
 */
export const getAuthenticatedContext = cache(async (): Promise<AuthenticatedContext | null> => {
  const session = getKindeServerSession();

  const rawAccessToken = await session.getAccessTokenRaw();
  if (!rawAccessToken) {
    return null;
  }

  const identity = await verifyKindeAccessToken(rawAccessToken);
  const enriched = await withProfileClaimsFromSession(session, identity);

  const userId = await ensureUser(enriched);
  const supabaseAccessToken = await mintSupabaseAccessToken(userId);

  return {
    userId,
    kindeUserId: identity.kindeUserId,
    supabase: rlsClient(supabaseAccessToken),
  };
});

/**
 * Fills in profile claims that Kinde puts in the ID token rather than the
 * access token (commonly `email`, `given_name`, `family_name`).
 *
 * These are only ever used to seed a *new* `users` row, and only when the
 * access token did not carry them. They are read from the SDK's session, which
 * on the web is safe for a specific reason: that session lives in a cookie the
 * SDK encrypts with our client secret and was populated by a server-side code
 * exchange, so its contents cannot be authored by the browser.
 *
 * **That reasoning does not transfer to mobile.** §5.2's flow sends a bearer
 * token to our API with no such cookie, so when the mobile path is built it
 * must obtain these claims by verifying the ID token against Kinde's JWKS the
 * same way `verifyKindeAccessToken` does, not by trusting a request body. The
 * `sub` equality check below is the invariant to preserve either way: profile
 * claims may only ever be attached to the identity that was actually verified.
 */
async function withProfileClaimsFromSession(
  session: ReturnType<typeof getKindeServerSession>,
  identity: KindeIdentity,
): Promise<KindeIdentity> {
  if (identity.email !== null) {
    return identity;
  }

  const user = await session.getUser();
  if (!user || user.id !== identity.kindeUserId) {
    // Either no ID token, or it describes a different person than the access
    // token we verified. Both are wrong enough to refuse rather than guess.
    return identity;
  }

  return {
    ...identity,
    email: user.email ?? identity.email,
    firstName: user.given_name ?? identity.firstName,
    lastName: user.family_name ?? identity.lastName,
  };
}
