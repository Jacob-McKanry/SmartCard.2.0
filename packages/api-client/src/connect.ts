/**
 * Typed HTTP client for the connect endpoints (`/api/connect/qr/*`).
 *
 * WHY THIS LIVES HERE AND NOT INLINE IN A COMPONENT
 * §1.7 / the header comment on `packages/types/src/connect/index.ts`: one
 * service layer reached by both platforms. Web calls these routes from the
 * browser (the presenter and scanner screens need a live polling/camera loop,
 * which is client-side by nature — a Server Action does not fit a fetch every
 * `rotateAfterSeconds`), and mobile will call the exact same routes over HTTP
 * later. Putting the request/response wiring here, driven by the same Zod
 * schemas that validate the routes themselves, means neither caller can drift
 * from what the route actually accepts and returns.
 *
 * WHAT THIS FILE DOES NOT DO
 * It does not decide anything. It does not know what a "rejection" means, does
 * not retry, does not poll, does not touch geolocation or the camera. It turns
 * a request object into a validated HTTP call and a response body into a typed
 * value (or a thrown `ConnectApiError`) and nothing more — the loop, the
 * retries-on-a-timer, and the UI state all belong to the screens that call
 * this.
 *
 * WHY ERRORS ARE MODELLED DIFFERENTLY FOR REDEEM THAN FOR SESSION/HEARTBEAT
 * `qr/redeem`'s own response shape (`ConnectRedeemResponse`,
 * `packages/types`) is a discriminated union — `{ ok: true, ... }` or
 * `{ ok: false, message }` — because a rejection there is an ordinary,
 * well-formed answer, not an exceptional one (§4.2 step 7: "a refusal is HTTP
 * 200, not a 4xx"). `redeemQr` below returns that union as-is; callers branch
 * on `.ok`. `qr/session` and `qr/heartbeat` have no such union in their
 * success shape, and the routes themselves signal a refusal by throwing
 * (`ConnectRefusedError` -> a non-2xx response carrying `{ ok: false,
 * message }`) — so `createQrSession`/`heartbeatQrSession` mirror that and
 * throw `ConnectApiError` rather than inventing a result type the server-side
 * code does not have.
 */
import {
  connectRedeemResponseSchema,
  nfcLocationAttachRequestSchema,
  nfcLocationAttachResponseSchema,
  nfcRedeemRequestSchema,
  qrHeartbeatRequestSchema,
  qrHeartbeatResponseSchema,
  qrRedeemRequestSchema,
  qrSessionCreateRequestSchema,
  qrSessionCreateResponseSchema,
  type ConnectRedeemResponse,
  type NfcLocationAttachRequest,
  type NfcLocationAttachResponse,
  type NfcRedeemRequest,
  type QrHeartbeatRequest,
  type QrHeartbeatResponse,
  type QrRedeemRequest,
  type QrSessionCreateRequest,
  type QrSessionCreateResponse,
} from "@smartcard/types";

export interface ConnectApiOptions {
  /** Prefixed onto every path. Empty string (same-origin relative fetch) by default — what the web app wants. */
  baseUrl?: string;
  /** Injectable so tests can run without a network and without a DOM `fetch` global. */
  fetchImpl?: typeof fetch;
}

/**
 * Thrown by every function in this file when the call did not succeed.
 *
 * `message` is always either something `userFacingMessage()` produced on the
 * server (see `packages/core/src/connect/user-messages.ts` — never write a
 * competing string for a case that reason already covers) or, for the one
 * case that never reaches the server at all, a plain "couldn't reach
 * SmartCard" string that says nothing about why — because there is nothing
 * server-authored to relay, and inventing detail here would be exactly the
 * kind of chattier-than-necessary message §4.2 step 7 exists to prevent, even
 * though this particular case is about the network rather than the other
 * party.
 *
 * `status` is the HTTP status when one was received, or `null` for a request
 * that never got a response at all (offline, DNS failure, CORS — anything
 * `fetch` itself throws on). It exists for logging/telemetry, never as
 * something a screen branches its user-facing copy on: the message string is
 * already the full extent of what the user should see.
 */
export class ConnectApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ConnectApiError";
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
 * POSTs `body` to `path` and parses the response with `parseSuccess`.
 *
 * `parseSuccess` is tried on the response body FIRST, regardless of HTTP
 * status — not gated behind `response.ok`. That is what lets `redeemQr`'s
 * `parseSuccess` (the full `ok: true | false` union) accept an ordinary
 * `{ ok: false, message }` refusal without this function treating it as a
 * transport error, while `createQrSession`/`heartbeatQrSession`'s
 * `parseSuccess` (the success shape alone, `.strict()`, no `ok` field) fails
 * to parse that exact same shape and correctly falls through to the
 * `isFailureShape` branch below. One code path serves both error models
 * because the schemas themselves, not an `if (response.ok)` here, are what
 * decide which shapes count as success.
 */
async function postConnect<TResponse>(
  path: string,
  body: unknown,
  parseSuccess: (json: unknown) => TResponse,
  opts: ConnectApiOptions,
): Promise<TResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? "";

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ConnectApiError(UNREACHABLE_MESSAGE, null);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ConnectApiError(UNREACHABLE_MESSAGE, response.status);
  }

  try {
    return parseSuccess(json);
  } catch {
    if (isFailureShape(json)) {
      throw new ConnectApiError(json.message, response.status);
    }
    throw new ConnectApiError(UNREACHABLE_MESSAGE, response.status);
  }
}

/** `POST /api/connect/qr/session` — §4.2 step 1. Throws `ConnectApiError` on any refusal. */
export async function createQrSession(
  input: QrSessionCreateRequest,
  opts: ConnectApiOptions = {},
): Promise<QrSessionCreateResponse> {
  const body = qrSessionCreateRequestSchema.parse(input);
  return postConnect("/api/connect/qr/session", body, (json) => qrSessionCreateResponseSchema.parse(json), opts);
}

/** `POST /api/connect/qr/heartbeat` — §4.2 steps 2 + 3. Throws `ConnectApiError` on any refusal. */
export async function heartbeatQrSession(
  input: QrHeartbeatRequest,
  opts: ConnectApiOptions = {},
): Promise<QrHeartbeatResponse> {
  const body = qrHeartbeatRequestSchema.parse(input);
  return postConnect("/api/connect/qr/heartbeat", body, (json) => qrHeartbeatResponseSchema.parse(json), opts);
}

/**
 * `POST /api/connect/qr/redeem` — §4.2 steps 4-7.
 *
 * Does NOT throw for an ordinary rejection — returns `{ ok: false, message }`
 * like the route does. Only throws `ConnectApiError` for something outside
 * the API's own contract: no network, a non-JSON body, or a body that matches
 * neither branch of the union.
 */
export async function redeemQr(
  input: QrRedeemRequest,
  opts: ConnectApiOptions = {},
): Promise<ConnectRedeemResponse> {
  const body = qrRedeemRequestSchema.parse(input);
  return postConnect("/api/connect/qr/redeem", body, (json) => connectRedeemResponseSchema.parse(json), opts);
}

/**
 * `POST /api/connect/nfc/redeem` — §4.5 step 3.
 *
 * Same error model as `redeemQr` and for the same reason (§4.2 step 7's
 * reasoning applies identically to §4.5): a rejected tap is an ordinary
 * `{ ok: false, message }` answer, not a thrown exception, so callers branch
 * on `.ok` rather than catching. `ConnectApiError` is reserved for what is
 * outside the API's own contract — no network, a non-JSON body, or a body
 * matching neither branch of the union.
 */
export async function redeemNfc(
  input: NfcRedeemRequest,
  opts: ConnectApiOptions = {},
): Promise<ConnectRedeemResponse> {
  const body = nfcRedeemRequestSchema.parse(input);
  return postConnect("/api/connect/nfc/redeem", body, (json) => connectRedeemResponseSchema.parse(json), opts);
}

/**
 * `POST /api/connect/nfc/location` — attaches a location to a tap that has
 * already connected (§4.5, amended 2026-08-28).
 *
 * THE ONE FUNCTION IN THIS FILE WHOSE FAILURE A CALLER SHOULD IGNORE. Every
 * other call here is the connection itself: a refusal is something the person
 * needs told. This one decorates a connection that already succeeded, so a
 * refusal — and a thrown `ConnectApiError` — means only that a place name
 * will be missing from a record. `card-redeem-flow.tsx` swallows both
 * deliberately; see its header for why surfacing either would report a
 * failure the user cannot act on about a tap that worked.
 */
export async function attachNfcLocation(
  input: NfcLocationAttachRequest,
  opts: ConnectApiOptions = {},
): Promise<NfcLocationAttachResponse> {
  const body = nfcLocationAttachRequestSchema.parse(input);
  return postConnect(
    "/api/connect/nfc/location",
    body,
    (json) => nfcLocationAttachResponseSchema.parse(json),
    opts,
  );
}
