import { attachNfcMeetingLocation } from "@/server/connect/nfc-location-service";
import { connectErrorResponse, readAuthenticatedRequest } from "@/server/connect/route-helpers";

/**
 * `POST /api/connect/nfc/location` — attaches a location to a card tap that
 * has ALREADY connected (§4.5, amended 2026-08-28).
 *
 * THIS ENDPOINT CANNOT CREATE A CONNECTION, AND THAT IS THE POINT. It writes
 * one row to `meeting_locations` for a meeting that already exists, through
 * `attach_nfc_meeting_location`, which refuses anything that is not an
 * `nfc_card` meeting the caller themselves tapped within the last few
 * minutes. It cannot touch `connections`, `meetings`, `meeting_participants`
 * or `connection_sessions` — not because this file declines to, but because
 * the function it calls has no statement that could, and no client role holds
 * an INSERT grant on any of them (20260809211200). §4.7 threat 4's "never add
 * a second path that writes connections" is intact: this is not one.
 *
 * WHY A SEPARATE REQUEST RATHER THAN A FIELD ON THE REDEEM. The redeem does
 * have such a field, and a client holding a fix should use it — see
 * `nfcLocationAttachRequestSchema`'s header for the full comparison. This
 * endpoint is for the web tap, where `/card/[code]` fires its redeem the
 * instant the page mounts and must not wait on a GPS acquisition to do it.
 *
 * SAME AUTH AND CSRF POSTURE AS EVERY OTHER CONNECT ROUTE, via
 * `readAuthenticatedRequest`: same-origin checked BEFORE the session is read,
 * then cookie-or-bearer authentication, then the body. Unlike its siblings
 * this one uses the caller's own RLS-bound client rather than the
 * service-role store, because the authorization it needs is "this is your own
 * meeting" and the service role has no identity to answer that with.
 *
 * A REFUSAL IS A 200, NOT AN ERROR STATUS. `{ attached: false }` is the
 * ordinary answer for every gate, and the caller has no decision to make on
 * it: the connection this decorates already committed and is unaffected
 * either way. Statuses that differed by reason would also rebuild the oracle
 * the RPC's single refusal shape exists to prevent.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { body, supabase } = await readAuthenticatedRequest(request);
    const response = await attachNfcMeetingLocation(supabase, body);
    return Response.json(response);
  } catch (error) {
    return connectErrorResponse(error, "nfc/location");
  }
}
