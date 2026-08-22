import { meetingPrivacyUpdateSchema } from "@smartcard/types";

import { apiErrorResponse, readJsonBody, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import { getConnectionForViewer, setMeetingLocationVisibility } from "@/server/connections/connections-service";

/**
 * `PATCH /api/v1/connections/[connectionId]/sharing` — the "share with mutual
 * connections" toggle. `(app)/connections/[connectionId]/actions.ts` binds
 * `meetingId` from the connection its own page already loaded, rather than
 * trusting a value the client could supply; this route reproduces that by
 * loading the connection ITSELF from `connectionId` and deriving
 * `origin_meeting_id` from it, never accepting a `meetingId` field in the
 * body. `getConnectionForViewer` returning `null` is treated as 404 for the
 * same reason `GET /api/v1/connections/[connectionId]` does — "not yours" and
 * "doesn't exist" must stay indistinguishable.
 *
 * Either participant may call this — the underlying RLS policy does not
 * distinguish which one is asking, and neither does this route.
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
    const update = meetingPrivacyUpdateSchema.parse(body);

    await setMeetingLocationVisibility(context.supabase, connection.origin_meeting_id, update);

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "PATCH /api/v1/connections/[connectionId]/sharing");
  }
}
