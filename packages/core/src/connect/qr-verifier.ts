/**
 * The `qr_gps` verification method (§4.2, §4.3).
 *
 * THE VALIDATION ORDER BELOW IS §4.2 STEP 5, EXACTLY, IN ORDER.
 * It is repeated here as a checklist because the order is itself a security
 * property and a reader must be able to confirm it without reading the whole
 * function:
 *
 *   1. HMAC signature — reject immediately, never interpret unverified data
 *   2. `exp` not passed
 *   3. session exists, `status = 'active'`
 *   4. session `expires_at` not passed
 *   5. nonce matches `current_nonce` or `previous_nonce`
 *   6. presenter != scanner
 *   7. not already connected, no block in either direction
 *   8. the GPS gate (§4.3, with relaxation)
 *   9. rate limits (§4.6)
 *
 * Nothing is skipped and nothing is reordered. Two of the orderings do real
 * work and should not be "optimised":
 *
 *   * (1) BEFORE EVERYTHING. The token is attacker-controlled bytes. Verifying
 *     the MAC before decoding the payload means no attacker-chosen structure is
 *     ever interpreted, and — because (1) and (2) are pure computation with no
 *     database access — it also means an unauthenticated flood cannot reach the
 *     database at all. That is what makes rate limits at (9) safe; see
 *     `rate-limits.ts`.
 *
 *   * (7) BEFORE (8). Checking "already connected" before the GPS gate means a
 *     pair who are already connected never generate a distance measurement at
 *     all. If the order were reversed, someone could re-scan a person they are
 *     already connected to purely to learn whether the GPS gate passed, which
 *     is a proximity oracle about that person, repeatable for free.
 *
 * WHY REJECTIONS RETURN RATHER THAN THROW
 * Every refusal below is a value the caller logs to `connection_attempts` with
 * its real reason and its real numbers (§4.2 step 7), before returning a
 * message that says none of them. A thrown exception would unwind past the
 * logging, and an audit log that loses exactly the interesting failures is
 * worse than none — it looks complete.
 */

import type { QrRedeemRequest } from "@smartcard/types";
import { qrRedeemRequestSchema } from "@smartcard/types";

import type { VerificationConfig } from "./config";
import { evaluateGpsGate } from "./gps-gate";
import { sealVerified } from "./internal/seal";
import type { ConnectStore } from "./ports";
import { HOUR_SECONDS, RATE_LIMIT_ACTIONS } from "./rate-limits";
import { RELAXATION_UNLOCKING_REASONS, type RejectionReason } from "./rejection-reasons";
import { evaluateRelaxation, thresholdsFor } from "./relaxation";
import { isTokenExpired, verifyQrToken } from "./qr-token";
import {
  reject,
  type GpsFix,
  type RequestContext,
  type VerificationEvidence,
  type VerificationMethod,
  type VerificationOutcome,
} from "./verification";

export interface QrVerifierDeps {
  store: ConnectStore;
  /** `QR_SIGNING_SECRET`. Server-side only — a client holding it can mint tokens for any session. */
  signingSecret: string;
  config: VerificationConfig;
}

export function createQrVerifier(deps: QrVerifierDeps): VerificationMethod<QrRedeemRequest> {
  const { store, signingSecret, config } = deps;

  return {
    id: "qr_gps",

    // Shape only, per §4.1. No authorization decision is made here.
    parse(raw: unknown): QrRedeemRequest {
      return qrRedeemRequestSchema.parse(raw);
    },

    async verify(ctx: RequestContext, input: QrRedeemRequest): Promise<VerificationOutcome> {
      // Every refusal carries the request's audit fields, so a rejection row is
      // as complete as a success row. §4.4's tuning questions are asked over
      // rejections, so a rejection missing its context is a gap in exactly the
      // half of the dataset that matters.
      const fail = (reason: RejectionReason, extra: Partial<VerificationEvidence> = {}) =>
        reject(reason, { ipHash: ctx.ipHash, userAgent: ctx.userAgent, ...extra });

      // --- (1) Signature -----------------------------------------------------
      const verified = await verifyQrToken(signingSecret, input.token);
      if (!verified.ok) {
        return fail(verified.reason);
      }
      const payload = verified.payload;

      // --- (2) Token expiry --------------------------------------------------
      if (isTokenExpired(payload, ctx.now)) {
        return fail("token_expired", { sessionId: payload.sid });
      }

      // --- (3) Session exists and is active ---------------------------------
      // A session that was burned by the five-failure rule is `revoked`, and a
      // consumed one is `consumed`; both land here, which is how "consuming the
      // session kills every outstanding token" (§4.7 threat 1) is enforced on
      // the read path. The write path enforces it again, atomically.
      const session = await store.loadSession(payload.sid);
      if (session === null || session.method !== "qr_gps" || session.status !== "active") {
        return fail("session_not_found", { sessionId: payload.sid });
      }

      // --- (4) Session lifetime ---------------------------------------------
      if (session.expiresAt.getTime() <= ctx.now.getTime()) {
        return fail("session_expired", {
          sessionId: session.id,
          presenterUserId: session.presenterUserId,
        });
      }

      // --- (5) Nonce ---------------------------------------------------------
      // `previous_nonce` is the rotation grace window: a scan already in flight
      // when the code rotated is a legitimate scan (§4.2 step 2). Anything older
      // than one rotation is not — which is what makes a screenshot taken a
      // minute ago useless even before the session is consumed.
      const nonceMatches =
        (session.currentNonce !== null && session.currentNonce === payload.nonce) ||
        (session.previousNonce !== null && session.previousNonce === payload.nonce);
      if (!nonceMatches) {
        return fail("nonce_mismatch", {
          sessionId: session.id,
          presenterUserId: session.presenterUserId,
        });
      }

      const presenterUserId = session.presenterUserId;
      const scannerUserId = ctx.callerUserId;
      const base: Partial<VerificationEvidence> = { sessionId: session.id, presenterUserId };

      // --- (6) Presenter is not the scanner ---------------------------------
      if (presenterUserId === scannerUserId) {
        return fail("self_connect", base);
      }

      // --- (7) Graph position ------------------------------------------------
      // Blocks are checked before "already connected" so a blocked caller gets
      // the block's reason in the audit log rather than a misleading one. Both
      // return the same words to the user, and `blocked` deliberately returns
      // the same generic message as an ordinary failure so nobody learns they
      // have been blocked (see `user-messages.ts`).
      if (await store.isBlockedEitherWay(presenterUserId, scannerUserId)) {
        return fail("blocked", base);
      }
      if (await store.areConnected(presenterUserId, scannerUserId)) {
        return fail("already_connected", base);
      }

      // --- (8) The GPS gate (§4.3), with relaxation --------------------------
      // Relaxation is decided first, because it decides which thresholds the
      // gate runs with. It is derived entirely from the audit log for this
      // ordered pair; the client cannot ask for it, is never told about it, and
      // cannot influence it except by genuinely failing on distance twice.
      const history = await store.loadRelaxationHistory({
        presenterUserId,
        scannerUserId,
        unlockingReasons: RELAXATION_UNLOCKING_REASONS,
        windowSeconds: config.qr_relaxation_window_seconds,
        now: ctx.now,
      });
      const relaxation = evaluateRelaxation(history, config, ctx.now);
      const thresholds = thresholdsFor(relaxation, config);

      const presenterFix = toFix(
        session.presenterLatitude,
        session.presenterLongitude,
        session.presenterAccuracyM,
        session.presenterLocationAt,
      );
      const scannerFix = toFix(
        input.scannerLocation.latitude,
        input.scannerLocation.longitude,
        input.scannerLocation.accuracyM,
        new Date(input.scannerLocation.capturedAt),
      );

      const gate = evaluateGpsGate({
        presenter: presenterFix,
        scanner: scannerFix,
        now: ctx.now,
        thresholds: {
          maxDistanceM: thresholds.maxDistanceM,
          maxAccuracyM: thresholds.maxAccuracyM,
          maxLocationAgeSeconds: config.presenter_location_max_age_seconds,
        },
      });

      // Recorded on EVERY attempt, accepted or refused, so §4.4's four tuning
      // questions can be answered over the whole dataset rather than over the
      // successes only.
      const measured: Partial<VerificationEvidence> = {
        ...base,
        distanceM: gate.distanceM,
        scannerAccuracyM: scannerFix?.accuracyM ?? null,
        presenterAccuracyM: presenterFix?.accuracyM ?? null,
        radiusConfigUsedM: thresholds.maxDistanceM,
        accuracyConfigUsedM: thresholds.maxAccuracyM,
        radiusMode: thresholds.radiusMode,
        relaxationSourceAttemptId: relaxation.sourceAttemptId,
      };

      if (!gate.ok) {
        return fail(gate.reason, measured);
      }

      // --- (9) Rate limits (§4.6) -------------------------------------------
      // Evaluated last, exactly as §4.2 step 5 lists them. Budget was already
      // spent at the top of the request by the route handler (see
      // `rate-limits.ts` for why consumption and enforcement are separated), so
      // this is the enforcement point, not the counting point.
      const withinUserLimit = await store.consumeRateLimit({
        action: RATE_LIMIT_ACTIONS.qrRedeem,
        subjectKind: "user",
        subjectKey: scannerUserId,
        limit: config.rate_limit_qr_redeem_per_user_hour,
        windowSeconds: HOUR_SECONDS,
      });
      if (!withinUserLimit) {
        return fail("rate_limited", measured);
      }

      return sealVerified({
        ok: true,
        initiatorUserId: scannerUserId,
        counterpartUserId: presenterUserId,
        method: "qr_gps",
        // See the judgment call on `profileRichness` in `verification.ts`.
        profileRichness: "preview",
        //
        // THE MEETING'S STORED LOCATION IS THE SCANNER'S FIX — not the
        // presenter's, and not a midpoint. Recorded because it is a real choice
        // with a privacy consequence that §2.4 does not make.
        //
        // The scanner's fix is the one captured deliberately, at the moment of
        // the scan, at high accuracy, for this purpose; the presenter's is a
        // background heartbeat that may be up to 90 seconds old. A midpoint
        // would be a coordinate at which neither person actually stood, which is
        // worse as a record and worse for the reverse-geocoded `place_label`
        // (§2.4 amendment). The gate has already proved the two were inside the
        // radius of each other, so storing one of them discloses nothing about
        // the other that the meeting itself does not.
        location: {
          latitude: input.scannerLocation.latitude,
          longitude: input.scannerLocation.longitude,
          accuracyM: input.scannerLocation.accuracyM,
        },
        evidence: {
          sessionId: session.id,
          presenterUserId,
          ipHash: ctx.ipHash,
          userAgent: ctx.userAgent,
          distanceM: gate.distanceM,
          scannerAccuracyM: input.scannerLocation.accuracyM,
          presenterAccuracyM: presenterFix?.accuracyM ?? null,
          radiusConfigUsedM: thresholds.maxDistanceM,
          accuracyConfigUsedM: thresholds.maxAccuracyM,
          radiusMode: thresholds.radiusMode,
          relaxationSourceAttemptId: relaxation.sourceAttemptId,
          eventId: null,
        },
      });
    },
  };
}

/**
 * Assembles a `GpsFix` only when every part of it is present.
 *
 * All-or-nothing on purpose: a fix with coordinates but no accuracy, or no
 * timestamp, cannot be evaluated against either the accuracy floor or the
 * freshness bound, and a partial fix that reached the gate would have to be
 * given a default for the missing part. Returning null instead sends it down
 * the `*_location_missing` path, which rejects — the direction §4.3's table
 * requires.
 */
function toFix(
  latitude: number | null,
  longitude: number | null,
  accuracyM: number | null,
  capturedAt: Date | null,
): GpsFix | null {
  if (latitude === null || longitude === null || accuracyM === null || capturedAt === null) {
    return null;
  }
  return { latitude, longitude, accuracyM, capturedAt };
}
