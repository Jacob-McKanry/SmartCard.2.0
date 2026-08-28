import "server-only";

import { ZodError } from "zod";

import { getApiAuthenticatedContext } from "@/server/auth/api-context";
import type { AuthenticatedContext } from "@/server/auth/current-user";
import { checkSameOrigin } from "@/server/connect/same-origin";
import { GENERIC_ACTION_ERROR, UserFacingError } from "@/server/errors";

/**
 * Shared plumbing for `/api/v1/*` Route Handlers — the mobile-reachable door
 * onto services that, until now, only Server Actions called.
 *
 * WHY THIS IS A SEPARATE MODULE FROM `connect/route-helpers.ts`
 *
 * The connect routes are a closed, unauthenticated-by-any-cookie-alone set with
 * their own error vocabulary (`RejectionReason`, `userFacingMessage`) that
 * predates this file and must not be disturbed. These routes wrap ordinary
 * service functions that already throw `UserFacingError` for anything a caller
 * should see (`errors.ts`) — the vocabulary this file needs is that one, not
 * the connect one. Sharing a module would mean importing connect's types into
 * every profile/feed/events route for no reason, or widening connect's helpers
 * to serve a shape they were not written for.
 *
 * WHAT EVERY ROUTE UNDER `/api/v1` MUST DO, AND WHY IT IS NOT DONE FOR THEM
 * AUTOMATICALLY
 *
 * 1. Authenticate — `requireApiContext`. Every route calls this; there is no
 *    variant that skips it, because there is no route in this group with a
 *    signed-out audience (contrast the card-preview and card-claim-landing
 *    paths, which are deliberately reachable without a session).
 * 2. For anything that WRITES, check same-origin FIRST — `requireSameOrigin`.
 *    `getApiAuthenticatedContext` accepts a browser's cookie as well as a
 *    bearer token, which means a mutating route reachable by cookie is exactly
 *    as CSRF-exposed as the connect routes are, for the identical reason:
 *    a forged cross-site POST carries a real session and would pass every
 *    check after it. `route-helpers.ts`'s header explains why the origin check
 *    must run BEFORE authentication (a session lookup proves nothing about who
 *    caused the request) — that ordering is reproduced here, not just the
 *    conclusion.
 *
 *    A GET that only reads is deliberately NOT required to call this. There is
 *    no state for a forged request to change, and without this app sending
 *    CORS headers a cross-origin page cannot read the response either — the
 *    same reasoning `/api/v1/me`'s header gives for skipping it.
 *
 * These are two separate calls, not one bundled helper, because the ordering
 * and the "which routes need which" answer differ from `connect`'s (every
 * connect route is a mutation; this group is a mix of reads and writes), and a
 * bundled helper would either force a same-origin check onto GETs that do not
 * need it or require a boolean flag to opt out — worse than two explicit calls
 * at the top of each route.
 */

export class ApiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

/**
 * Refuses a cross-site browser request before anything else runs. Call this
 * FIRST, before `requireApiContext`, in every route that writes.
 */
export function requireSameOrigin(request: Request): void {
  const result = checkSameOrigin(request.headers, request.url);
  if (!result.ok) {
    console.warn("[api] refused a cross-site request", {
      reason: result.reason,
      // Safe to log: the attacker's own origin, never the victim's data.
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    });
    throw new ApiHttpError(403, "That request wasn't valid.");
  }
}

/** Authenticates the caller, by cookie or bearer token. 401/503 on failure — never a fallback identity. */
export async function requireApiContext(request: Request): Promise<AuthenticatedContext> {
  const auth = await getApiAuthenticatedContext(request.headers);
  if (!auth.ok) {
    throw new ApiHttpError(
      auth.status,
      auth.status === 503
        ? "We couldn't verify your sign-in just now. Try again in a moment."
        : "You need to be signed in.",
    );
  }
  return auth.context;
}

/**
 * Parses the request body as JSON. Returns `{}` for an empty body so a route
 * whose every field is optional does not need its own special case — the same
 * convenience `connect/route-helpers.ts` gives the QR session endpoint.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiHttpError(400, "That request wasn't valid JSON.");
  }
}

/**
 * Turns anything thrown inside an `/api/v1/*` route into a `Response`.
 *
 * THE THREE THINGS A ROUTE IS ALLOWED TO SAY, IN ORDER
 *
 *  1. `ApiHttpError` — this file's own refusals (bad origin, bad auth, bad
 *     JSON). The message was written for a caller and crosses unchanged.
 *  2. `ZodError` — a validation failure on the CALLER'S OWN submitted body.
 *     `errors.ts`'s rule for `UserFacingError` is that a message may describe
 *     the caller's own action and their own data; a Zod issue about a field
 *     they just sent is exactly that, never a fact about anyone else's row.
 *     This mirrors the Server Actions, which run their own `safeParse` and
 *     return `error.issues[0].message` directly rather than the generic
 *     fallback — see `(app)/profile/actions.ts`'s `firstIssue`.
 *  3. `UserFacingError` — a service function's own opt-in message.
 *
 * Everything else collapses to `errors.ts`'s one generic sentence, logged in
 * full server-side. A service function's plain `Error` wraps a PostgREST
 * message that can name a table, a column or a constraint (`errors.ts`'s own
 * header gives real examples), and none of that belongs in an HTTP response
 * any more than it belongs in a Server Action's rendered state.
 */
export function apiErrorResponse(error: unknown, endpoint: string): Response {
  if (error instanceof ApiHttpError) {
    return Response.json({ ok: false, message: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? "That value isn't valid.";
    return Response.json({ ok: false, message }, { status: 400 });
  }
  if (error instanceof UserFacingError) {
    return Response.json({ ok: false, message: error.message }, { status: 400 });
  }

  console.error(`[api] unhandled error in ${endpoint}`, {
    error: error instanceof Error ? error.message : String(error),
    cause:
      error instanceof Error && error.cause !== undefined
        ? typeof error.cause === "object"
          ? JSON.stringify(error.cause)
          : String(error.cause)
        : undefined,
    stack: error instanceof Error ? error.stack : undefined,
  });

  return Response.json({ ok: false, message: GENERIC_ACTION_ERROR }, { status: 500 });
}
