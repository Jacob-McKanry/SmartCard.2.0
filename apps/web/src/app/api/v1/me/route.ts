import { getApiAuthenticatedContext } from "@/server/auth/api-context";

/**
 * `GET /api/v1/me` — the smallest possible authenticated endpoint, and the
 * first route under `/api/v1`.
 *
 * WHY THIS EXISTS WHEN THE APP DOES NOT NEED IT
 *
 * It proves the mobile auth chain end to end without a phone. Point curl at it
 * with a Kinde access token and a 200 means all five steps ran: the bearer
 * token was extracted, verified against Kinde's JWKS, attributed to one of our
 * two Kinde applications by `azp`, resolved to a `public.users` row, and used
 * to mint a Supabase token that RLS accepted. A 401 means the token was
 * refused; a 503 means Kinde's key server could not be reached. There is no
 * other combination, and nothing here can pass while any link is broken.
 *
 * It is also the natural health check for the seam once the mobile app exists:
 * "am I still signed in" is a question a client asks on launch, and answering it
 * from the same helper every other route uses means the answer cannot disagree
 * with what those routes will do.
 *
 * WHAT IT DELIBERATELY DOES NOT RETURN
 *
 * A profile. It answers with the caller's own `userId` and `kindeUserId` and
 * nothing else — no name, no email, no photo. Those belong to the profile
 * endpoint, which reads them through the caller's RLS-bound client like every
 * other screen does. An identity endpoint that also happens to return profile
 * fields becomes the thing people call instead of the real one, and then it
 * grows fields, and then it is a second profile reader with its own idea of
 * what a caller may see. `kindeUserId` is included because a client that just
 * completed a PKCE exchange has it and can assert the exchange landed on the
 * account it expected; it is never a query key outside `ensureUser`.
 *
 * NO SAME-ORIGIN CHECK, UNLIKE THE CONNECT ROUTES
 *
 * `checkSameOrigin` exists to stop a third-party page CAUSING a state change
 * with somebody's ambient cookie. This route changes nothing — it is a GET that
 * reads the caller's own id — so there is no action for a forged request to
 * trigger and nothing a cross-site caller could learn that the browser would
 * hand back to the attacker's page anyway (a cross-origin `fetch` cannot read
 * the response without CORS, which this app does not send). Routes added later
 * that WRITE must take the connect routes' posture, not this one.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await getApiAuthenticatedContext(request.headers);

  if (!auth.ok) {
    return Response.json(
      {
        ok: false,
        message:
          auth.status === 503
            ? "We couldn't verify your sign-in just now. Try again in a moment."
            : "You need to be signed in.",
      },
      { status: auth.status },
    );
  }

  return Response.json({
    ok: true,
    userId: auth.context.userId,
    kindeUserId: auth.context.kindeUserId,
  });
}
