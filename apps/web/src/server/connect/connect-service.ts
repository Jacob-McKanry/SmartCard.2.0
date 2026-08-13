import "server-only";

import {
  ConnectionCommitError,
  createNfcVerifier,
  createQrVerifier,
  createVerifiedConnection,
  generateNonce,
  HOUR_SECONDS,
  RATE_LIMIT_ACTIONS,
  signQrToken,
  userFacingMessage,
  type ConnectStore,
  type RejectionReason,
  type RequestContext,
  type VerificationConfig,
  type VerificationOutcome,
} from "@smartcard/core";
import type {
  ConnectRedeemResponse,
  QrHeartbeatRequest,
  QrHeartbeatResponse,
  QrSessionCreateRequest,
  QrSessionCreateResponse,
} from "@smartcard/types";
import {
  nfcRedeemRequestSchema,
  qrHeartbeatRequestSchema,
  qrRedeemRequestSchema,
  qrSessionCreateRequestSchema,
} from "@smartcard/types";

import { sendCardTapNotification } from "@/server/connect/push";
import { supabaseConnectStore } from "@/server/connect/supabase-connect-store";
import { qrSigningSecret } from "@/server/env";
import { serviceRoleClient } from "@/server/supabase/service-role-client";

/**
 * The connect flow's service layer (§1.7: "one API, one service layer").
 *
 * Everything a route handler does beyond authenticating the caller and shaping
 * an HTTP response lives here, so that the web routes and (later) the mobile
 * client reach exactly one implementation of "create a verified connection".
 * There is no second copy of any authorization decision.
 *
 * WHAT THIS LAYER OWNS AND WHAT IT DELEGATES
 *   * Owns: rate-limit budget consumption at the top of every request, writing
 *     the `connection_attempts` row for a rejection, burning a session after
 *     five failures, and firing the card-tap notification after a commit.
 *   * Delegates: the verification decision itself, entirely, to the verifiers in
 *     `packages/core`. Nothing here decides whether a connection is allowed.
 *
 * WHAT A CALLER IS EVER TOLD
 * Every failure returns `{ ok: false, message }` with a message from
 * `userFacingMessage()` and nothing else — no reason code, no numbers, no field
 * naming which check failed (§4.2 step 7). The real reason and the real numbers
 * go to `connection_attempts`, which has no read policy for anybody (§3.5).
 */

export interface ConnectServiceDeps {
  store: ConnectStore;
  signingSecret: string;
}

/** Production wiring. Overridable so tests can drive the same code with a fake store. */
export function defaultDeps(): ConnectServiceDeps {
  return { store: supabaseConnectStore(), signingSecret: qrSigningSecret() };
}

/**
 * The per-IP budget, consumed at the top of EVERY connect request (§4.6, last
 * row) before anything else happens.
 *
 * Two details worth stating:
 *
 *  1. A request with no usable IP header is charged to the literal subject
 *     `"unknown"` rather than skipping the limit. Skipping would make "send no
 *     `x-forwarded-for`" the way to opt out of the only limit that is not
 *     tied to an account.
 *
 *  2. Q22(a) requires this limit to be generous, because hundreds of attendees
 *     share one NAT IP on venue wifi and this must never be the constraint that
 *     bites at an event. The per-user and per-session limits are the ones doing
 *     the real work; this one exists to stop a single host hammering the
 *     endpoints.
 */
async function withinIpLimit(
  store: ConnectStore,
  config: VerificationConfig,
  ipHash: string | null,
): Promise<boolean> {
  return store.consumeRateLimit({
    action: RATE_LIMIT_ACTIONS.connectEndpoint,
    subjectKind: "ip",
    subjectKey: ipHash ?? "unknown",
    limit: config.rate_limit_connect_per_ip_hour,
    windowSeconds: HOUR_SECONDS,
  });
}

export class ConnectRefusedError extends Error {
  constructor(
    readonly reason: RejectionReason,
    readonly httpStatus: number = 400,
  ) {
    super(userFacingMessage(reason));
    this.name = "ConnectRefusedError";
  }
}

// ---------------------------------------------------------------------------
// §4.2 step 1 — create a session
// ---------------------------------------------------------------------------

/**
 * Creates a `connection_sessions` row and returns the first signed token.
 *
 * WHY THE FIRST TOKEN COMES BACK FROM HERE AND THE REST COME FROM THE HEARTBEAT
 * §4.2 step 2 describes token issuance "every 30s" without saying where from,
 * and the choice is recorded rather than left implicit. Three options were
 * available: hand the client a batch of future tokens, give rotation its own
 * polled endpoint, or fold rotation into the heartbeat the presenter already
 * has to send.
 *
 *   * A batch is disqualified outright. Rotation exists so that a photograph of
 *     the screen is stale within seconds (§4.7 threat 1); a batch of future
 *     tokens in the client's memory is a photograph of the next several
 *     minutes.
 *   * A separate polled endpoint works but adds a second request on the same
 *     cadence as one the presenter is already making.
 *   * Folding it into the heartbeat is the choice made here, and it is not just
 *     fewer requests — it is a security gain. The nonce only rotates when a
 *     fresh location arrives, so a presenter CANNOT keep displaying current
 *     codes while their location goes stale. The two freshness properties the
 *     GPS gate depends on become one property that cannot be half-satisfied.
 *
 * The cost, accepted deliberately: a presenter who loses location permission
 * or backgrounds the app stops getting fresh codes and their session goes
 * stale. That is the correct outcome — a scan against a stale-located session
 * would be rejected by the GPS gate anyway (§4.3), so the alternative is a
 * screen that looks like it is working and is not. It is also exactly the UX
 * cost §4.2 step 3 flags for pilot observation as Q8.
 */
export async function createQrSession(
  ctx: RequestContext,
  raw: unknown,
  deps: ConnectServiceDeps = defaultDeps(),
): Promise<QrSessionCreateResponse> {
  const input: QrSessionCreateRequest = qrSessionCreateRequestSchema.parse(raw);
  const config = await deps.store.loadConfig();

  if (!(await withinIpLimit(deps.store, config, ctx.ipHash))) {
    throw new ConnectRefusedError("rate_limited", 429);
  }

  const withinUserLimit = await deps.store.consumeRateLimit({
    action: RATE_LIMIT_ACTIONS.qrSessionCreate,
    subjectKind: "user",
    subjectKey: ctx.callerUserId,
    limit: config.rate_limit_qr_session_create_per_user_hour,
    windowSeconds: HOUR_SECONDS,
  });
  if (!withinUserLimit) {
    throw new ConnectRefusedError("rate_limited", 429);
  }

  const nonce = generateNonce();
  const expiresAt = new Date(ctx.now.getTime() + config.session_max_lifetime_seconds * 1000);

  const session = await deps.store.createSession({
    presenterUserId: ctx.callerUserId,
    method: "qr_gps",
    nonce,
    deviceId: input.deviceId ?? null,
    expiresAt,
    now: ctx.now,
  });

  return {
    sessionId: session.id,
    token: await mintToken(deps.signingSecret, session.id, nonce, ctx.now, config),
    rotateAfterSeconds: config.qr_rotation_seconds,
    expiresAt: session.expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// §4.2 steps 2 + 3 — heartbeat, and the rotation folded into it
// ---------------------------------------------------------------------------

export async function heartbeatQrSession(
  ctx: RequestContext,
  raw: unknown,
  deps: ConnectServiceDeps = defaultDeps(),
): Promise<QrHeartbeatResponse> {
  const input: QrHeartbeatRequest = qrHeartbeatRequestSchema.parse(raw);
  const config = await deps.store.loadConfig();

  if (!(await withinIpLimit(deps.store, config, ctx.ipHash))) {
    throw new ConnectRefusedError("rate_limited", 429);
  }

  // The store pins the update to `presenter_user_id = caller` and
  // `status = 'active'`, so a caller can only heartbeat their own live session.
  // A null result means one of those was false; the caller is told the session
  // is gone and nothing about which condition failed.
  const session = await deps.store.heartbeat({
    sessionId: input.sessionId,
    presenterUserId: ctx.callerUserId,
    latitude: input.location.latitude,
    longitude: input.location.longitude,
    accuracyM: input.location.accuracyM,
    capturedAt: new Date(input.location.capturedAt),
    now: ctx.now,
    rotationSeconds: config.qr_rotation_seconds,
    nextNonce: generateNonce(),
  });

  if (session === null || session.currentNonce === null) {
    throw new ConnectRefusedError("session_not_found", 404);
  }

  return {
    token: await mintToken(deps.signingSecret, session.id, session.currentNonce, ctx.now, config),
    rotateAfterSeconds: config.qr_rotation_seconds,
    expiresAt: session.expiresAt.toISOString(),
  };
}

/**
 * `exp = iat + qr_token_ttl_seconds` (45s), deliberately longer than the 30s
 * rotation so there is always a grace window for a scan that was in flight when
 * the code changed (§4.2 step 2). The nonce's own grace window
 * (`previous_nonce`) is the other half of the same idea.
 */
async function mintToken(
  secret: string,
  sessionId: string,
  nonce: string,
  now: Date,
  config: VerificationConfig,
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return signQrToken(secret, {
    sid: sessionId,
    nonce,
    iat,
    exp: iat + Math.floor(config.qr_token_ttl_seconds),
  });
}

// ---------------------------------------------------------------------------
// §4.2 steps 4-7 — redeem a scanned QR code
// ---------------------------------------------------------------------------

export async function redeemQr(
  ctx: RequestContext,
  raw: unknown,
  deps: ConnectServiceDeps = defaultDeps(),
): Promise<ConnectRedeemResponse> {
  const config = await deps.store.loadConfig();

  // Consumed at the top so that budget is spent by TRYING, not by getting far
  // enough to be checked. The refusal itself is still returned here rather than
  // at §4.2's step 9 for this one limit, because a per-IP flood is exactly what
  // it exists to stop and letting it run the whole pipeline first would defeat
  // that. The per-USER redeem limit is the one §4.2 orders at step 9, and it is
  // enforced there, inside the verifier.
  if (!(await withinIpLimit(deps.store, config, ctx.ipHash))) {
    return { ok: false, message: userFacingMessage("rate_limited") };
  }

  // Shape validation before the verifier. A malformed body never reaches the
  // signature check, and — because the schemas are `.strict()` — an unexpected
  // field is a hard failure rather than a silently ignored one.
  const parsed = qrRedeemRequestSchema.safeParse(raw);
  if (!parsed.success) {
    // Logged as a malformed token rather than dropped: §4.6's "all rejections
    // logged, never silently dropped".
    await logRejection(deps.store, ctx, "qr_gps", "malformed_token", null);
    return { ok: false, message: userFacingMessage("malformed_token") };
  }

  const verifier = createQrVerifier({
    store: deps.store,
    signingSecret: deps.signingSecret,
    config,
  });
  const outcome = await verifier.verify(ctx, parsed.data);

  if (!outcome.ok) {
    await recordQrRejection(deps.store, ctx, outcome, config);
    return { ok: false, message: userFacingMessage(outcome.reason) };
  }

  try {
    const created = await createVerifiedConnection(deps.store, outcome);
    return { ok: true, connectionId: created.connectionId, meetingId: created.meetingId };
  } catch (error) {
    return handleCommitFailure(deps.store, ctx, "qr_gps", outcome, error);
  }
}

/**
 * Writes the rejection row, then applies §4.6's five-failures-burns-the-session
 * rule.
 *
 * The failure count is read from `connection_attempts` rather than from a
 * counter of its own, for the same reason relaxation state is derived rather
 * than stored (§4.3's judgment call): a second source of truth can disagree
 * with the audit log, and disagreement between an audit log and a live security
 * decision is the worst class of bug this design can have.
 *
 * Burning sets the session to `revoked`, so every subsequent attempt — and
 * every outstanding token minted from it — dies at §4.2 step 5.3.
 */
async function recordQrRejection(
  store: ConnectStore,
  ctx: RequestContext,
  outcome: Extract<VerificationOutcome, { ok: false }>,
  config: VerificationConfig,
): Promise<void> {
  const sessionId = outcome.evidence.sessionId;

  await store.logAttempt({
    sessionId,
    method: "qr_gps",
    scannerUserId: ctx.callerUserId,
    presenterUserId: outcome.evidence.presenterUserId,
    outcome: "rejected",
    rejectionReason: outcome.reason,
    distanceM: outcome.evidence.distanceM,
    scannerAccuracyM: outcome.evidence.scannerAccuracyM,
    presenterAccuracyM: outcome.evidence.presenterAccuracyM,
    radiusConfigUsedM: outcome.evidence.radiusConfigUsedM,
    accuracyConfigUsedM: outcome.evidence.accuracyConfigUsedM,
    radiusMode: outcome.evidence.radiusMode,
    relaxationSourceAttemptId: outcome.evidence.relaxationSourceAttemptId,
    ipHash: ctx.ipHash,
    userAgent: ctx.userAgent,
  });

  if (sessionId === null) return;

  const failures = await store.countSessionRejections(sessionId);
  if (failures >= config.rate_limit_qr_redeem_failures_per_session) {
    await store.burnSession(sessionId);
  }
}

// ---------------------------------------------------------------------------
// §4.5 — redeem a tapped card
// ---------------------------------------------------------------------------

export async function redeemNfc(
  ctx: RequestContext,
  raw: unknown,
  deps: ConnectServiceDeps = defaultDeps(),
): Promise<ConnectRedeemResponse> {
  const config = await deps.store.loadConfig();

  if (!(await withinIpLimit(deps.store, config, ctx.ipHash))) {
    return { ok: false, message: userFacingMessage("rate_limited") };
  }

  const parsed = nfcRedeemRequestSchema.safeParse(raw);
  if (!parsed.success) {
    await logRejection(deps.store, ctx, "nfc_card", "card_not_found", null);
    return { ok: false, message: userFacingMessage("card_not_found") };
  }

  const verifier = createNfcVerifier({ store: deps.store, config });
  const outcome = await verifier.verify(ctx, parsed.data);

  if (!outcome.ok) {
    await logRejection(
      deps.store,
      ctx,
      "nfc_card",
      outcome.reason,
      outcome.evidence.presenterUserId,
    );
    return { ok: false, message: userFacingMessage(outcome.reason) };
  }

  let connectionId: string;
  let meetingId: string;
  try {
    const created = await createVerifiedConnection(deps.store, outcome);
    connectionId = created.connectionId;
    meetingId = created.meetingId;
  } catch (error) {
    return handleCommitFailure(deps.store, ctx, "nfc_card", outcome, error);
  }

  // AFTER the commit, never inside it, and never able to affect it. §4.5's
  // amendment requires the notification to be enqueued server-side in the same
  // service function — never triggered by the scanner's client, which would let
  // the tapper suppress the owner's alert simply by dropping the call — but
  // also requires that a send failure never blocks or reverses the connection.
  // Both are satisfied by calling it here and ignoring what it returns beyond
  // logging; `sendCardTapNotification` itself resolves on every failure path.
  await notifyCardOwner(ctx, outcome.counterpartUserId, outcome.evidence, connectionId, config);

  return { ok: true, connectionId, meetingId };
}

/**
 * Fires the card-tap notification (§4.5 amendment, Q17).
 *
 * The coalescing count is derived from `connection_sessions`: every card tap
 * creates one `nfc_card` session for the owner, already consumed, so "how many
 * taps of this person's cards landed in the last N seconds?" is a single query
 * against a table that already exists. No new counter, no second source of
 * truth.
 *
 * DEVIATION, RECORDED RATHER THAN GLOSSED. §4.5's amendment describes "one
 * notification, then a rolled-up 'and 4 others tapped your card' within 300s",
 * which implies a deferred send at the end of the window. There is no scheduler
 * or job queue in this project (pg_cron is not enabled, and enabling an
 * extension is its own decision), so what is built is the closest form that
 * needs neither: the first tap in a window notifies immediately, further taps
 * inside the window do not push again, and the next notification after the
 * window carries the rolled-up count. The property that matters — an owner is
 * never trained to ignore the alert by thirty pushes in a minute — holds; the
 * property that does not hold is that the rollup arrives promptly rather than
 * on the next tap. Worth revisiting when anything else in the product needs a
 * scheduler.
 */
async function notifyCardOwner(
  ctx: RequestContext,
  ownerUserId: string,
  evidence: Record<string, unknown>,
  connectionId: string,
  config: VerificationConfig,
): Promise<void> {
  try {
    const client = serviceRoleClient();
    const windowStart = new Date(
      ctx.now.getTime() - config.nfc_tap_notification_coalesce_seconds * 1000,
    ).toISOString();

    const { count } = await client
      .from("connection_sessions")
      .select("id", { count: "exact", head: true })
      .eq("method", "nfc_card")
      .eq("presenter_user_id", ownerUserId)
      .gte("consumed_at", windowStart);

    // This tap is included in the count, so "others" is one fewer.
    const otherTapCount = Math.max(0, (count ?? 1) - 1);

    // Only the tapper's display name — the ceiling §4.5's amendment sets. Read
    // with the service role because the owner may not be able to see this
    // person's profile yet at the instant of the tap.
    const { data: tapper } = await client
      .from("users")
      .select("first_name, last_name")
      .eq("id", ctx.callerUserId)
      .maybeSingle<{ first_name: string | null; last_name: string | null }>();

    const displayName =
      [tapper?.first_name, tapper?.last_name].filter(Boolean).join(" ").trim() || "Someone";

    const result = await sendCardTapNotification(
      {
        ownerUserId,
        cardId: String(evidence.cardId ?? ""),
        tapperDisplayName: displayName,
        connectionId,
        otherTapCount,
      },
      client,
    );

    if (result.skippedReason !== undefined) {
      console.info("[connect] card-tap notification not delivered", {
        ownerUserId,
        reason: result.skippedReason,
      });
    }
  } catch (error) {
    // Belt and braces on top of `sendCardTapNotification`'s own catch-all. The
    // connection is already committed; nothing here may undo it.
    console.error("[connect] card-tap notification path threw", {
      ownerUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * A commit refusal means the verifier said yes and the database said no — i.e.
 * the world changed between the check and the write: a block appeared, a
 * concurrent redeem consumed the session, or the same pair was connected by
 * another request. Logged as `commit_refused` so that a spike in these is
 * visible as the race it is, rather than being filed under whichever check it
 * happens to duplicate.
 */
async function handleCommitFailure(
  store: ConnectStore,
  ctx: RequestContext,
  method: "qr_gps" | "nfc_card",
  outcome: Extract<VerificationOutcome, { ok: true }>,
  error: unknown,
): Promise<ConnectRedeemResponse> {
  const reason: RejectionReason =
    error instanceof ConnectionCommitError ? "commit_refused" : "internal_error";

  console.error("[connect] verified outcome failed to commit", {
    method,
    reason,
    error: error instanceof Error ? error.message : String(error),
  });

  await logRejection(store, ctx, method, reason, outcome.counterpartUserId);
  return { ok: false, message: userFacingMessage(reason) };
}

async function logRejection(
  store: ConnectStore,
  ctx: RequestContext,
  method: "qr_gps" | "nfc_card",
  reason: RejectionReason,
  presenterUserId: string | null,
): Promise<void> {
  await store.logAttempt({
    sessionId: null,
    method,
    scannerUserId: ctx.callerUserId,
    presenterUserId,
    outcome: "rejected",
    rejectionReason: reason,
    distanceM: null,
    scannerAccuracyM: null,
    presenterAccuracyM: null,
    radiusConfigUsedM: null,
    accuracyConfigUsedM: null,
    radiusMode: "normal",
    relaxationSourceAttemptId: null,
    ipHash: ctx.ipHash,
    userAgent: ctx.userAgent,
  });
}
