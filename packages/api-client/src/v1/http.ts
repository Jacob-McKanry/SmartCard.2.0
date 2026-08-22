/**
 * Shared HTTP plumbing for every `/api/v1/*` wrapper in this directory.
 *
 * WHY THIS IS SEPARATE FROM `postConnect` IN `../connect.ts`
 *
 * `postConnect` is POST-only and its two response shapes are bespoke per
 * caller (`redeemQr`'s full `{ok:true|false}` union vs.
 * `createQrSession`'s success-only shape that throws on refusal). Every
 * `/api/v1/*` route built in Phase 1 answers the same envelope regardless of
 * method — `{ ok: true, ...fields }` or `{ ok: false, message }` — because
 * they all share `apps/web/src/server/api/route-context.ts`'s
 * `apiErrorResponse`. One helper for one envelope is simpler than bending
 * `postConnect` to a shape it was not written for, and this file's
 * `parseSuccess` argument still comes from a schema in `@smartcard/types`,
 * so the "one schema per shape, both ends" rule this package's `index.ts`
 * states is unchanged.
 *
 * WHY A BEARER TOKEN IS AN EXPLICIT OPTION HERE, WITH NOTHING SIMILAR ON
 * `postConnect`
 *
 * The connect routes predate the mobile auth seam and are called from the
 * browser today, where the session cookie is attached automatically. Every
 * `/api/v1/*` route accepts a bearer token INSTEAD of a cookie
 * (`server/auth/api-context.ts`), which is what makes them reachable from a
 * client with no cookie jar at all — a mobile app holding a Kinde token in
 * secure storage. `accessToken` is optional and omitted entirely from the
 * request when absent, rather than sent as an empty header: an
 * `Authorization: Bearer ` with nothing after it is a malformed header, not
 * an absent one, and `api-context.ts`'s parser treats the two differently
 * (see its own tests for exactly how).
 */

import { okResponseSchema } from "@smartcard/types";

/**
 * `parseSuccess` for the many mutating endpoints that answer with nothing but
 * `{ ok: true }` — one shared function so `requestApiV1<void>(...)` call sites
 * do not each write their own ad hoc shape check. Uses `okResponseSchema`
 * (`@smartcard/types`), the same schema the response actually mirrors, rather
 * than a bespoke `typeof json === "object" && ...` inline at every call site.
 */
export function parseOk(json: unknown): void {
  okResponseSchema.parse(json);
}

export interface ApiV1Options {
  /** Prefixed onto every path. Empty string (same-origin relative fetch) by default — what the web app wants. */
  baseUrl?: string;
  /** Injectable so tests can run without a network and without a DOM `fetch` global. */
  fetchImpl?: typeof fetch;
  /** A Kinde access token, for a caller with no session cookie. Omit on web. */
  accessToken?: string;
}

/**
 * Thrown by every function in this directory when the call did not succeed.
 * Same shape and same reasoning as `ConnectApiError` in `../connect.ts`:
 * `message` is either the server's own `apiErrorResponse` text or, for a call
 * that never reached the server at all, a plain "couldn't reach SmartCard"
 * string with no invented detail. `status` is for logging only, never
 * something a screen branches its copy on.
 */
export class ApiV1Error extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ApiV1Error";
  }
}

const UNREACHABLE_MESSAGE = "Couldn't reach SmartCard. Check your connection and try again.";

function isFailureShape(value: unknown): value is { ok: false; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok: unknown }).ok === false &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  );
}

/**
 * Issues one `/api/v1/*` request and parses the response with `parseSuccess`.
 *
 * `parseSuccess` is tried on the body FIRST, regardless of HTTP status — the
 * same ordering `postConnect` uses and for the same reason: the schema
 * itself, not `response.ok`, is what decides whether a shape counts as
 * success. Every schema in `@smartcard/types/api` carries `ok: z.literal(true)`,
 * so an `{ ok: false, ... }` body fails to parse and falls through to the
 * `isFailureShape` branch below on its own, with no separate status check
 * needed here.
 */
export async function requestApiV1<TResponse>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown | undefined,
  parseSuccess: (json: unknown) => TResponse,
  opts: ApiV1Options,
): Promise<TResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? "";

  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.accessToken !== undefined && opts.accessToken !== "") {
    headers["Authorization"] = `Bearer ${opts.accessToken}`;
  }

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiV1Error(UNREACHABLE_MESSAGE, null);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiV1Error(UNREACHABLE_MESSAGE, response.status);
  }

  try {
    return parseSuccess(json);
  } catch {
    if (isFailureShape(json)) {
      throw new ApiV1Error(json.message, response.status);
    }
    throw new ApiV1Error(UNREACHABLE_MESSAGE, response.status);
  }
}
