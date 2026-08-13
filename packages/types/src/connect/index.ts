/**
 * Request and response shapes for the connect endpoints (§4.2, §4.5).
 *
 * These live in `packages/types` rather than beside the routes because §1.7 has
 * exactly one service layer reached by both platforms: web calls the routes
 * from the browser, mobile will call the same routes over HTTP, and
 * `packages/api-client` will type both. One schema drives the route's runtime
 * validation and every caller's compile-time types, so a field cannot be added
 * on one side and forgotten on the other.
 *
 * WHAT IS DELIBERATELY ABSENT FROM EVERY REQUEST SHAPE HERE
 * There is no `userId`, no `presenterUserId`, no `ownerUserId`, and no
 * `distance` — not optional, not nullable, ABSENT. The caller's identity comes
 * from `getAuthenticatedContext()` on the server (§5.4's token exchange), the
 * counterpart's identity is resolved server-side from the session or the card
 * code, and the distance is computed server-side by `packages/core`. A shape
 * with no slot for a client-asserted identity cannot have one filled in by
 * accident, which is a stronger guarantee than remembering to ignore it.
 *
 * VALIDATION HERE IS SHAPE ONLY (§4.1: "parse(raw): Zod — shape only").
 * Nothing in this file decides whether an action is allowed. Keeping "is this
 * the right shape?" apart from "is this permitted?" is what stops a schema
 * tweak from quietly becoming a policy change.
 *
 * Every object schema is `.strict()`, so an unexpected property is a hard
 * validation failure rather than a silently ignored one. §4.7 threat 5 lists
 * "Zod schemas stripping unknown fields against mass assignment"; strict goes
 * one better on a security endpoint — a request carrying a field this API does
 * not know about is a request written against a different idea of this API,
 * and refusing it is cheaper than reasoning about what the sender expected.
 */
import { z } from "zod";

import { accuracyMetresSchema, latitudeSchema, longitudeSchema, uuidSchema } from "../db/scalars";

/**
 * A GPS fix as a device reports it.
 *
 * `capturedAt` is when the DEVICE took the fix, not when the request arrived.
 * Freshness is judged from it (§4.3 checks 1 and 2), and the server bounds it
 * against its own clock — a fix claiming to come from the future is refused
 * rather than treated as maximally fresh (see `gps-gate.ts`).
 */
export const gpsFixInputSchema = z
  .object({
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    accuracyM: accuracyMetresSchema,
    capturedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type GpsFixInput = z.infer<typeof gpsFixInputSchema>;

/**
 * A device identifier, used to bind a session to the device that created it
 * (§4.7 threat 3). Bounded, because it is attacker-controlled text that ends up
 * in a database column.
 */
const deviceIdSchema = z.string().min(1).max(128);

// ---------------------------------------------------------------------------
// POST /api/connect/qr/session   (§4.2 step 1)
// ---------------------------------------------------------------------------
export const qrSessionCreateRequestSchema = z
  .object({
    deviceId: deviceIdSchema.optional(),
  })
  .strict();

export type QrSessionCreateRequest = z.infer<typeof qrSessionCreateRequestSchema>;

/**
 * What the presenter's screen needs to display and keep alive.
 *
 * Note the absence of anything about the presenter: the response tells the
 * caller about their own session and nothing else. `rotateAfterSeconds` and
 * `expiresAt` are the presenter's own timings, not thresholds — the numbers in
 * `app_config` that decide whether somebody else's scan succeeds are never sent
 * to any client (§3.5: publishing them tells an attacker exactly how far away
 * they may stand).
 */
export const qrSessionCreateResponseSchema = z
  .object({
    sessionId: uuidSchema,
    token: z.string(),
    /** How long until the presenter should post the next heartbeat and receive a fresh token. */
    rotateAfterSeconds: z.number().positive(),
    /** When this session dies regardless of activity (§2.5 `session_max_lifetime_seconds`). */
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type QrSessionCreateResponse = z.infer<typeof qrSessionCreateResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/connect/qr/heartbeat   (§4.2 step 3, and step 2's rotation)
// ---------------------------------------------------------------------------
export const qrHeartbeatRequestSchema = z
  .object({
    sessionId: uuidSchema,
    location: gpsFixInputSchema,
  })
  .strict();

export type QrHeartbeatRequest = z.infer<typeof qrHeartbeatRequestSchema>;

export const qrHeartbeatResponseSchema = z
  .object({
    /** The token to display now. Unchanged from the previous heartbeat until rotation is due. */
    token: z.string(),
    rotateAfterSeconds: z.number().positive(),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type QrHeartbeatResponse = z.infer<typeof qrHeartbeatResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/connect/qr/redeem   (§4.2 steps 4-7)
// ---------------------------------------------------------------------------
export const qrRedeemRequestSchema = z
  .object({
    /**
     * The signed token read out of the QR code. Bounded at 4096 characters
     * before anything computes a MAC over it — an unbounded string handed to a
     * hash function is a cheap way to make a server do expensive work.
     */
    token: z.string().min(1).max(4096),
    scannerLocation: gpsFixInputSchema,
    deviceId: deviceIdSchema.optional(),
  })
  .strict();

export type QrRedeemRequest = z.infer<typeof qrRedeemRequestSchema>;

// ---------------------------------------------------------------------------
// POST /api/connect/nfc/redeem   (§4.5 step 3)
// ---------------------------------------------------------------------------
/**
 * The code from the tapped URL `https://smartcard.tech/card/<code>`.
 *
 * Format is `<cosmetic-prefix>-<12 hex chars>`, with two legacy rows (ids 114
 * and 115) that are a bare 12-hex code with no prefix at all — recorded in §6.3
 * as a correction to §2.2's survey. The pattern below therefore makes the
 * prefix optional, because rejecting those two cards would make two real pieces
 * of physical inventory silently unusable.
 *
 * The pattern is a cheap shape filter, not a security control: the security is
 * that the 12-hex suffix is 48 bits of non-user-chosen randomness, unique
 * across all 7,142 cards, backed by the §4.6 rate limit against guessing. Its
 * value here is that a malformed code is refused before it reaches a database
 * lookup.
 */
export const cardCodeSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/^(?:[A-Za-z0-9_-]{1,64}-)?[0-9a-fA-F]{12}$/, "That doesn't look like a SmartCard code.");

export const nfcRedeemRequestSchema = z
  .object({
    code: cardCodeSchema,
  })
  .strict();

export type NfcRedeemRequest = z.infer<typeof nfcRedeemRequestSchema>;

// ---------------------------------------------------------------------------
// Shared redeem response
// ---------------------------------------------------------------------------
/**
 * The response both redeem endpoints return.
 *
 * The failure shape carries a message and nothing else — no reason code, no
 * numbers, no field naming which check failed. §4.2 step 7 forbids returning
 * the distance, the radius or anything about the other party's location, and a
 * machine-readable reason code is the same leak with a smaller audience: it
 * would tell a script exactly which knob to turn next. The real reason goes to
 * `connection_attempts`, which no client can read (§3.5).
 */
export const connectRedeemResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      connectionId: uuidSchema,
      meetingId: uuidSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      message: z.string(),
    })
    .strict(),
]);

export type ConnectRedeemResponse = z.infer<typeof connectRedeemResponseSchema>;
