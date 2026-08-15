import "server-only";

import { userFacingMessage, type RequestContext } from "@smartcard/core";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { ConnectRefusedError } from "@/server/connect/connect-service";
import { buildRequestContext } from "@/server/connect/request-context";
import { checkSameOrigin } from "@/server/connect/same-origin";

/**
 * Shared plumbing for the `/api/connect/*` Route Handlers.
 *
 * WHY EVERY CONNECT ENDPOINT AUTHENTICATES FIRST, WITH NO EXCEPTIONS
 * §4.2 step 4 and §4.5 step 3 both have the caller send their auth token, and
 * there is no anonymous path anywhere in this flow. `getAuthenticatedContext()`
 * runs the whole §5.4 chain — Kinde session, JWKS verification, `ensureUser()`,
 * a freshly minted 5-minute Supabase token — and returns null when there is no
 * signed-in user. Null is a 401 here, never a fallback identity and never a
 * silent no-op: on this codepath, silence is indistinguishable from a bypass.
 *
 * A Route Handler is a public HTTP endpoint reachable by anyone who can send
 * the request, whether or not they ever loaded a page of ours — the same
 * property the Profile Server Actions were written against. The UI that calls
 * these routes is not a security boundary and is not built yet at all; these
 * checks are the whole of the boundary.
 *
 * WHY THE SAME-ORIGIN CHECK COMES BEFORE THE AUTHENTICATION CHECK
 * These endpoints are authenticated by a cookie, which the browser attaches
 * because of where the request is going rather than because of who caused it to
 * be sent — so "is the caller signed in?" is the wrong first question. A
 * cross-site forged POST is sent BY a signed-in victim and passes every
 * downstream check on its way to creating a connection nobody was present for.
 * `checkSameOrigin` refuses to let a third-party page be the thing that asks,
 * before any session is read or any token is minted. Read `same-origin.ts` for
 * what it checks and why `SameSite=Lax` is not treated as sufficient on its own.
 *
 * WHY THE ERROR SHAPE IS SO PLAIN
 * §4.2 step 7: a rejection tells the user that it did not work and nothing
 * else. That extends to unexpected errors — an exception's message can name a
 * table, a column, a constraint, or a user id, and none of that belongs in a
 * response to somebody who just failed a proximity check. Every unhandled error
 * becomes the same generic message, with the detail going to the server log.
 */

export interface AuthenticatedConnectRequest {
  ctx: RequestContext;
  body: unknown;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Authenticates the caller and reads the JSON body.
 *
 * The body is returned as `unknown` on purpose. Every caller passes it straight
 * to a Zod schema, and typing it as anything else here would be the first step
 * toward somebody reading a field off it before it has been validated.
 */
export async function readAuthenticatedRequest(
  request: Request,
): Promise<AuthenticatedConnectRequest> {
  // BEFORE the session is read — see the header. A forged cross-site request
  // carries a perfectly valid session, so authenticating first would prove
  // nothing about whether this app asked for the request.
  const sameOrigin = checkSameOrigin(request.headers, request.url);
  if (!sameOrigin.ok) {
    // Logged with the specific reason so a spike is diagnosable; the caller is
    // told nothing beyond "no", matching §4.2 step 7's posture everywhere else
    // on this path.
    console.warn("[connect] refused a cross-site request", {
      reason: sameOrigin.reason,
      // Safe to log: this is the attacker's own origin, not the victim's data.
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    });
    throw new HttpError(403, "That request wasn't valid.");
  }

  const auth = await getAuthenticatedContext();
  if (auth === null) {
    throw new HttpError(401, "You need to be signed in to connect.");
  }

  let body: unknown;
  try {
    // An empty body is a legitimate request for the session endpoint, whose
    // only field is optional.
    const text = await request.text();
    body = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    throw new HttpError(400, "That request wasn't valid.");
  }

  return {
    ctx: buildRequestContext({ callerUserId: auth.userId, headers: request.headers }),
    body,
  };
}

/**
 * Turns anything thrown inside a connect route into a response.
 *
 * `ConnectRefusedError` already carries a user-safe message from
 * `userFacingMessage()`. Everything else — a Zod failure, a database error, a
 * bug — collapses to one generic message and a 500, with the real detail logged
 * server-side. That collapse is deliberate: distinguishing "your JSON was
 * malformed" from "the session lookup failed" tells a prober which of the nine
 * checks in §4.2 step 5 they reached.
 */
export function connectErrorResponse(error: unknown, endpoint: string): Response {
  if (error instanceof HttpError) {
    return Response.json({ ok: false, message: error.message }, { status: error.status });
  }
  if (error instanceof ConnectRefusedError) {
    return Response.json({ ok: false, message: error.message }, { status: error.httpStatus });
  }

  console.error(`[connect] unhandled error in ${endpoint}`, {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  return Response.json(
    { ok: false, message: userFacingMessage("internal_error") },
    { status: 500 },
  );
}
