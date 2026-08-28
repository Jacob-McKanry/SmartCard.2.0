import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  nfcLocationAttachRequestSchema,
  nfcLocationAttachResponseSchema,
  type NfcLocationAttachResponse,
} from "@smartcard/types";

import { geocodeMeetingLocation } from "@/server/connect/geocode";

/**
 * The service layer for `POST /api/connect/nfc/location` — attaching a
 * location to a card tap after the fact (§4.5, amended 2026-08-28; see
 * `20260828160000_fn_attach_nfc_meeting_location.sql` for the security
 * argument and `nfcLocationAttachRequestSchema` for why this exists
 * alongside the redeem's own optional `location`).
 *
 * WHY THIS IS ITS OWN FILE RATHER THAN A FUNCTION IN `connect-service.ts`
 *
 * That module is built entirely around the service-role `ConnectStore` and
 * the verifier/outcome/commit pipeline — every export takes `deps.store` and
 * runs a `VerificationMethod`. This runs none of that: there is no verifier,
 * no outcome, no graph write, and the call goes through the CALLER'S OWN
 * RLS-bound client rather than the store, because the authorization it needs
 * ("is this the caller's own tap?") is a question only a connection carrying
 * a real identity can answer. Putting it in `connect-service.ts` would mean
 * one module with two different trust models and two different clients, which
 * is how somebody later reaches for the wrong one.
 *
 * NOTHING HERE DECIDES ANYTHING. Whether the meeting exists, is an
 * `nfc_card` one, belongs to the caller, is recent enough, and has no
 * location yet are five gates inside `attach_nfc_meeting_location`, re-derived
 * from `private.current_user_id()` on every call. This file validates the
 * request's SHAPE and translates the answer. If every line below were wrong,
 * the database would still refuse to write a position onto a meeting the
 * caller was not part of.
 */

/**
 * Attaches `location` to `meetingId`, then reverse-geocodes it.
 *
 * NEVER THROWS FOR A REFUSAL, AND THE CALLER MUST NOT TREAT ONE AS AN ERROR.
 * `{ attached: false }` is the ordinary answer for every gate in the RPC —
 * and, deliberately, for a malformed request too. This whole path is
 * best-effort decoration on a connection that already committed: the tap
 * succeeded, the two people are connected, and the only thing at stake is
 * whether a place name appears next to it later. A thrown error here would
 * turn a cosmetic miss into a visible failure on a screen that has nothing
 * to report.
 *
 * A transport failure IS allowed to throw, matching `claimEventImport` and
 * `claimUnassignedCard`: "we could not ask" is a monitoring problem, and the
 * route above logs it and answers with the same `{ attached: false }` the
 * caller would have got anyway.
 */
export async function attachNfcMeetingLocation(
  supabase: SupabaseClient,
  raw: unknown,
): Promise<NfcLocationAttachResponse> {
  const parsed = nfcLocationAttachRequestSchema.safeParse(raw);
  if (!parsed.success) {
    // Not thrown, and not distinguished from a refusal. A caller who sent a
    // malformed body learns exactly what a caller who named somebody else's
    // meeting learns, which is the §3.6 posture the RPC itself takes.
    return { attached: false };
  }

  const { meetingId, location } = parsed.data;

  const { data, error } = await supabase.rpc("attach_nfc_meeting_location", {
    p_meeting_id: meetingId,
    p_latitude: location.latitude,
    p_longitude: location.longitude,
    p_accuracy_m: location.accuracyM,
    p_captured_at: location.capturedAt,
  });

  if (error) {
    throw new Error(`Failed to attach the tap's location: ${error.message}`, { cause: error });
  }

  const result = nfcLocationAttachResponseSchema.safeParse(data);
  if (!result.success) {
    // An unrecognised shape reads as "not attached", never as success — the
    // same defensive posture `claimUnassignedCard` takes, and here it costs
    // nothing at all because nothing downstream depends on the answer.
    return { attached: false };
  }

  // Only when a row was actually written by THIS call. Geocoding a meeting
  // whose location somebody else already attached would be a second write
  // racing the first one's label for no reason, and geocoding a refusal would
  // spend a paid vendor request on a meeting that has no location at all.
  //
  // AWAITED, NOT DETACHED, for the reason `geocodeMeetingLocation`'s own
  // header gives: Vercel functions can freeze once a response is sent, so an
  // un-awaited call after `return` is not guaranteed to run. It never throws,
  // so it cannot turn this into a failure — the identical arrangement the QR
  // path and `redeemNfc` already use.
  if (result.data.attached) {
    await geocodeMeetingLocation(meetingId, location.latitude, location.longitude);
  }

  return result.data;
}
