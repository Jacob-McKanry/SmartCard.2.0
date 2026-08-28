import { apiErrorResponse, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import {
  getConnectionForViewer,
  getMeetingLocation,
  getMeetingParticipants,
  getMeetingRecord,
  getOtherParticipantProfile,
  removeConnection,
} from "@/server/connections/connections-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";

/**
 * `GET /api/v1/connections/[connectionId]`, `DELETE .../[connectionId]`.
 *
 * `GET` reproduces `(app)/connections/[connectionId]/page.tsx`'s exact data
 * assembly — same four parallel reads keyed off `connection.origin_meeting_id`,
 * same "meeting or otherUser missing means 404" rule, same photo pairing. Not
 * a new design: a mobile detail screen needs the same facts the web one
 * renders, gathered the same way. The derived `LocationSharingStatus` lives in
 * `packages/core` deliberately, NOT reproduced here — see that module's
 * header for why platform-independent logic belongs where both callers can
 * unit-test it without a database, and see the note below on why it is not
 * called from this route yet.
 *
 * WHY A 404 HERE, WHEN EVERY OTHER ROUTE IN THIS GROUP RETURNS A GENERIC 500
 * OR A UserFacingError
 *
 * `getConnectionForViewer`'s own contract is that "no such connection" and
 * "exists, but you are not a party to it" must be indistinguishable — the
 * `connections` select policy already collapses them, and inventing a
 * sharper answer here (say, a 403 for "not yours") would be exactly the
 * disclosure that function's header says the page must not make. A plain 404
 * with no body preserves that; `apiErrorResponse`'s generic collapse is not
 * used for this branch because there is nothing exceptional about it — it is
 * the ordinary, expected answer for an id that does not resolve.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const { connectionId } = await params;
    const { supabase, userId } = context;

    const connection = await getConnectionForViewer(supabase, connectionId);
    if (connection === null) {
      return Response.json({ ok: false, message: "No such connection." }, { status: 404 });
    }

    const otherUserId =
      connection.user_a_id === userId ? connection.user_b_id : connection.user_a_id;

    const [meeting, participants, location, otherUser] = await Promise.all([
      getMeetingRecord(supabase, connection.origin_meeting_id),
      getMeetingParticipants(supabase, connection.origin_meeting_id),
      getMeetingLocation(supabase, connection.origin_meeting_id),
      getOtherParticipantProfile(supabase, otherUserId),
    ]);

    // Same rule as the web page, including the 2026-08-15 amendment: a
    // deleted counterpart's profile stops resolving while the connection row
    // stays `active` on purpose, and this looks identical to the
    // structurally-impossible "meeting vanished" case. Both 404, and neither
    // is distinguished from the other here for the same reason.
    if (meeting === null || otherUser === null) {
      return Response.json({ ok: false, message: "No such connection." }, { status: 404 });
    }

    const viewerParticipant = participants.find((p) => p.user_id === userId) ?? null;
    const otherParticipant = participants.find((p) => p.user_id === otherUserId) ?? null;
    if (viewerParticipant === null || otherParticipant === null) {
      return Response.json({ ok: false, message: "No such connection." }, { status: 404 });
    }

    const photoUrl = await signedProfilePhotoUrl(supabase, otherUser.photo_path);

    return Response.json({
      ok: true,
      connection,
      meeting,
      viewerParticipant,
      otherParticipant,
      location,
      otherUser,
      photoUrl,
    });
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/connections/[connectionId]");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);
    const { connectionId } = await params;

    await removeConnection(context.supabase, connectionId);

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "DELETE /api/v1/connections/[connectionId]");
  }
}
