import "server-only";

import type {
  CreateManualConnectionRequest,
  CreateManualConnectionResponse,
} from "@smartcard/types";

import { serviceRoleClient } from "@/server/supabase/service-role-client";

/**
 * The service layer for the unverified "add a contact" flow (2026-09-26,
 * docs/architecture/2026-09-26-unverified-connections.md) — manual entry, OCR
 * card scan, badge QR/barcode, badge NFC tap. All four converge here, and
 * here is the ONE place that calls `public.create_manual_connection`
 * (20260926130000).
 *
 * WHY THIS IS NOT PART OF `connect-service.ts` / `ConnectStore`
 *
 * `connect-service.ts` and the `ConnectStore` port exist for the VERIFIED
 * flows, whose entire shape is built around a pluggable, type-branded
 * verifier (`VerificationMethod<T>` / `VerifiedOutcome` — see
 * `packages/core/src/connect/verification.ts`). This flow has no verifier at
 * all — that is the product decision — so routing it through the same
 * abstraction would either force a fake "always succeeds" verifier into
 * existence (blurring the one thing that abstraction is for: proving an
 * outcome came from real verification logic) or require widening
 * `ConnectStore` with methods that have nothing to do with proximity
 * verification. A separate, plainly-named service function is more honest
 * about what this is.
 *
 * WHY THE SERVICE ROLE, NOT THE CALLER'S OWN RLS-BOUND CLIENT
 *
 * `create_manual_connection` is granted to `service_role` alone (same
 * posture as `create_verified_connection`, same reasoning in that function's
 * own header) — there is deliberately no path for `authenticated` to call it
 * directly, so a client-side bug or a compromised browser cannot mint its
 * own connections outside this one server-side function.
 */

export class ManualConnectionCommitError extends Error {
  constructor(readonly reason: string) {
    super(`The connection could not be created: ${reason}`);
    this.name = "ManualConnectionCommitError";
  }
}

interface CreateManualConnectionRpcResult {
  ok: boolean;
  reason?: string;
  connection_id?: string;
  meeting_id?: string;
  other_user_id?: string;
  reconnected?: boolean;
}

/**
 * Turns `create_manual_connection`'s internal reason code into a sentence.
 *
 * Unlike the verified flows' `userFacingMessage()` (§4.2 step 7's "collapse
 * everything to one generic message"), most of these reasons are safe and
 * useful to say plainly — there is no proximity gate or session state to
 * protect here, and telling someone "that's already one of your connections"
 * is a normal product message, not an information leak. `other_party_unavailable`
 * and `other_party_not_found` are deliberately worded the same as each other:
 * neither should tell a caller whether a given email belongs to a real,
 * deleted, or nonexistent account.
 */
function messageFor(reason: string | undefined): string {
  switch (reason) {
    case "creator_not_active":
      return "You need to be signed in to do that.";
    case "invalid_method":
    case "invalid_other_party":
      return "That didn't work. Please try again.";
    case "other_party_not_found":
    case "other_party_unavailable":
      return "That contact isn't available to add right now.";
    case "self_connect":
      return "That's your own contact info.";
    case "blocked":
      return "You can't add this person.";
    case "already_connected":
      return "You're already connected to this person.";
    default:
      return "That didn't work. Please try again.";
  }
}

/**
 * Creates a connection with no proximity or identity verification — the
 * single entry point every "add a contact" input mode (manual form, OCR,
 * QR/barcode, NFC badge) calls into.
 *
 * `creatorUserId` comes from `getAuthenticatedContext()`, never from the
 * request body — same discipline as every other action in this codebase
 * (see `events/actions.ts`'s header for why that matters even though this is
 * a Server Action, not a raw route).
 */
export async function createManualConnection(
  creatorUserId: string,
  request: CreateManualConnectionRequest,
): Promise<CreateManualConnectionResponse> {
  const { data, error } = await serviceRoleClient().rpc("create_manual_connection", {
    p_creator_user_id: creatorUserId,
    p_method: request.method,
    p_other_user_id: request.otherUserId ?? null,
    p_other_contact: request.otherContact ?? null,
    p_occurred_at: request.occurredAt ?? new Date().toISOString(),
    p_latitude: request.location?.latitude ?? null,
    p_longitude: request.location?.longitude ?? null,
    p_accuracy_m: request.location?.accuracyM ?? null,
  });

  if (error) {
    // A transport/shape failure, not a refusal the RPC itself decided —
    // those come back as {ok:false, reason} in `data`, handled below.
    throw new ManualConnectionCommitError(`rpc_error: ${error.message}`);
  }

  const result = data as CreateManualConnectionRpcResult | null;

  if (result === null || result.ok !== true) {
    return { ok: false, message: messageFor(result?.reason) };
  }

  if (
    typeof result.connection_id !== "string" ||
    typeof result.meeting_id !== "string" ||
    typeof result.other_user_id !== "string"
  ) {
    // The RPC said ok but the shape is not what this function promises to
    // its caller — a bug worth surfacing loudly rather than silently
    // returning a connection id that might be undefined.
    throw new ManualConnectionCommitError("malformed_success_response");
  }

  return {
    ok: true,
    connectionId: result.connection_id,
    meetingId: result.meeting_id,
    otherUserId: result.other_user_id,
    reconnected: result.reconnected === true,
  };
}
