/**
 * The `nfc_card` verification method (§4.5).
 *
 * WHY THERE IS NO GPS GATE ON THIS PATH, AND WHY THAT IS NOT A WEAKER RULE
 * NFC's read range is a few centimetres. Physical range IS the proximity proof,
 * and it is a better one than GPS: it cannot be spoofed from another city by a
 * rooted phone, because the tap requires the card and the phone to be touching.
 * §4.5 is explicit that no GPS is collected here at all — which also means an
 * `nfc_card` meeting never gets a `meeting_locations` row, permanently. Absence
 * of location is represented by absence of the row (§2.4).
 *
 * THE CLIENT'S CLAIMED OWNER IS NEVER TRUSTED
 * The request carries one field: the code from the tapped URL. The owner is
 * resolved server-side from `cards.card_code`. There is no field in
 * `nfcRedeemRequestSchema` for an owner id, deliberately — a shape with no slot
 * for a client-asserted identity cannot have one filled in by accident.
 *
 * THE CODE IS THE SECRET, WHICH CHANGES WHERE THE RATE LIMIT GOES
 * §2.2/Q1: `card_code` is both the printed label and the security-bearing
 * lookup value — its 12-hex suffix is 48 bits of non-user-chosen randomness,
 * unique across all 7,142 cards. Unlike the QR path there is no cheap
 * cryptographic gate in front of the database, because the code IS the
 * credential: the very first thing this path does is a lookup. So the per-user
 * and per-IP limits are enforced BEFORE the lookup (the route handler does the
 * IP one; this verifier does the user one), and the per-card limit immediately
 * after it, since it cannot be evaluated until the code resolves to a card.
 * §4.5 specifies no validation order, so this is not a deviation from one — but
 * it does differ from the QR path, and the difference is deliberate.
 *
 * WHAT DEFENDS A STOLEN CARD (§4.7 threat 7)
 * Nothing on this path prevents it: whoever holds the card can connect to its
 * owner, and Q17 decided against a confirmation step because it would break the
 * one thing a card is good at. The defence is detection latency — the owner is
 * pushed a notification the instant a tap commits, with revoke one tap away —
 * plus the per-card rate limit capping the damage before they react. The
 * notification is fired by the route handler AFTER this verifier and after the
 * commit, never inside them; see the route for why a notification failure must
 * not touch the connection.
 */

import type { NfcRedeemRequest } from "@smartcard/types";
import { nfcRedeemRequestSchema } from "@smartcard/types";

import type { VerificationConfig } from "./config";
import { sealVerified } from "./internal/seal";
import type { ConnectStore } from "./ports";
import { HOUR_SECONDS, RATE_LIMIT_ACTIONS } from "./rate-limits";
import type { RejectionReason } from "./rejection-reasons";
import {
  reject,
  type RequestContext,
  type VerificationEvidence,
  type VerificationMethod,
  type VerificationOutcome,
} from "./verification";

export interface NfcVerifierDeps {
  store: ConnectStore;
  config: VerificationConfig;
}

/**
 * The outcome carries the resolved card so the route can notify its owner and
 * so a rejection can be attributed. It is deliberately NOT part of
 * `VerificationEvidence`'s named fields — `connection_attempts` has no card
 * column, and adding one would put the card id in the audit log without §2.5
 * having decided that it belongs there.
 */
export interface NfcVerificationContext {
  cardId: string | null;
  ownerUserId: string | null;
}

export function createNfcVerifier(
  deps: NfcVerifierDeps,
): VerificationMethod<NfcRedeemRequest> & { lastResolvedCard(): NfcVerificationContext } {
  const { store, config } = deps;

  // Scoped per verifier instance, and a verifier instance is created per
  // request by the route handler. It is never shared across requests — a
  // module-level cache here would be one user's card visible to another's
  // request, which is the classic shape of a cross-request data leak.
  let resolved: NfcVerificationContext = { cardId: null, ownerUserId: null };

  return {
    id: "nfc_card",

    parse(raw: unknown): NfcRedeemRequest {
      return nfcRedeemRequestSchema.parse(raw);
    },

    lastResolvedCard(): NfcVerificationContext {
      return resolved;
    },

    async verify(ctx: RequestContext, input: NfcRedeemRequest): Promise<VerificationOutcome> {
      const fail = (reason: RejectionReason, extra: Partial<VerificationEvidence> = {}) =>
        reject(reason, { ipHash: ctx.ipHash, userAgent: ctx.userAgent, ...extra });

      // Per-user limit BEFORE the lookup. This is the limit that actually
      // resists brute-forcing card codes, because a guesser has to be a
      // signed-in user: 60 attempts an hour against a 48-bit unique suffix is
      // not a search that finishes.
      const withinUserLimit = await store.consumeRateLimit({
        action: RATE_LIMIT_ACTIONS.nfcRedeem,
        subjectKind: "user",
        subjectKey: ctx.callerUserId,
        limit: config.rate_limit_nfc_redeem_per_user_hour,
        windowSeconds: HOUR_SECONDS,
      });
      if (!withinUserLimit) {
        return fail("rate_limited");
      }

      // §4.5 step 4 — resolve the code, server-side, to a card.
      const card = await store.findCardByCode(input.code);
      if (card === null) {
        return fail("card_not_found");
      }
      resolved = { cardId: card.id, ownerUserId: card.ownerUserId };

      // Per-card limit. §4.7 threat 7: this is what caps how many connections a
      // found card produces before its owner reacts to the notification. It is
      // consumed even for a card that then fails one of the checks below, so a
      // rejected tap still spends the card's budget — otherwise "tap a revoked
      // card repeatedly" would be free.
      const withinCardLimit = await store.consumeRateLimit({
        action: RATE_LIMIT_ACTIONS.nfcRedeem,
        subjectKind: "card",
        subjectKey: card.id,
        limit: config.rate_limit_nfc_redeem_per_card_hour,
        windowSeconds: HOUR_SECONDS,
      });
      if (!withinCardLimit) {
        return fail("rate_limited");
      }

      // `revoked` is the owner's kill switch for a lost or stolen card. It is
      // checked before `assigned`, so a revoked card that still has an owner
      // reports the honest reason to the audit log — the user-facing message is
      // identical either way, on purpose: telling a tapper "this card was
      // revoked" confirms they are holding somebody's lost property and are
      // being watched, which helps them and not the owner.
      if (card.status === "revoked") {
        return fail("card_revoked", { presenterUserId: card.ownerUserId });
      }
      if (card.status !== "assigned" || card.ownerUserId === null) {
        // An unassigned card is stock nobody owns — there is no person on the
        // other side of the tap. The CHECK constraint `cards_assigned_requires_
        // owner` makes "assigned with no owner" unrepresentable, so the null
        // test is belt and braces against a future schema change rather than a
        // state that exists today.
        return fail("card_unassigned");
      }

      const ownerUserId = card.ownerUserId;
      const base: Partial<VerificationEvidence> = { presenterUserId: ownerUserId };

      // Tapping your own card is not a connection, and the ordered-pair CHECK on
      // `connections` makes it unrepresentable anyway. Refused here so it is
      // logged as what it is rather than as a constraint violation.
      if (ownerUserId === ctx.callerUserId) {
        return fail("self_connect", base);
      }

      // A tap by someone the owner has blocked never gets past this point, which
      // is what stops the tap notification being used as a channel to reach
      // somebody who blocked you (§4.5 amendment's last practical detail).
      if (await store.isBlockedEitherWay(ownerUserId, ctx.callerUserId)) {
        return fail("blocked", base);
      }
      if (await store.areConnected(ownerUserId, ctx.callerUserId)) {
        return fail("already_connected", base);
      }

      return sealVerified({
        ok: true,
        initiatorUserId: ctx.callerUserId,
        counterpartUserId: ownerUserId,
        method: "nfc_card",
        // §4.5 step 5 fixes this at `full`.
        profileRichness: "full",
        // No `location`: there is no GPS on this path and there must never be.
        // Adding one would collect a position for a check that does not exist.
        evidence: {
          // Null: the atomic write creates the `connection_sessions` row itself,
          // in the same transaction, already `consumed`. §3.6's judgment call on
          // `meetings.verification_session_id` being NOT NULL is explicit that
          // the NFC path must create a session rather than the constraint being
          // dropped.
          sessionId: null,
          presenterUserId: ownerUserId,
          ipHash: ctx.ipHash,
          userAgent: ctx.userAgent,
          distanceM: null,
          scannerAccuracyM: null,
          presenterAccuracyM: null,
          radiusConfigUsedM: null,
          accuracyConfigUsedM: null,
          radiusMode: "normal",
          relaxationSourceAttemptId: null,
          eventId: null,
          cardId: card.id,
        },
      });
    },
  };
}
