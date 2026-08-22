import { meetingParticipantConsentUpdateSchema } from "@smartcard/types";

import { apiErrorResponse, readJsonBody, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import { getConnectionForViewer, setOwnParticipantFlags } from "@/server/connections/connections-service";

/**
 * `PATCH /api/v1/connections/[connectionId]/participant-flags` — the
 * caller's own `location_share_consent` / `marked_private`. Same derivation
 * as the sibling `sharing` route: `meetingId` comes from the connection this
 * route loads itself, never from the body, so there is no field here that
 * could point the write at a meeting the caller was not part of. RLS enforces
 * the same boundary underneath regardless — this is belt-and-braces, matching
 * `connections-service.ts`'s own stated posture for every function in that
 * module.
 */
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);
    const { connectionId } = await params;

    const connection = await getConnectionForViewer(context.supabase, connectionId);
    if (connection === null) {
      return Response.json({ ok: false, message: "No such connection." }, { status: 404 });
    }

    const body = await readJsonBody(request);
    const update = meetingParticipantConsentUpdateSchema.parse(body);

    await setOwnParticipantFlags(context.supabase, connection.origin_meeting_id, context.userId, update);

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "PATCH /api/v1/connections/[connectionId]/participant-flags");
  }
}
