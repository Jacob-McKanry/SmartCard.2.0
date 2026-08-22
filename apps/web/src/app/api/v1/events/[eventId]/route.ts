import { eventUpdateSchema } from "@smartcard/types";

import { apiErrorResponse, readJsonBody, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import {
  getConnectionsAttending,
  getEventAttendanceCounts,
  getEventForViewer,
  getEventHostProfile,
  getOwnConnectionsAtEvent,
  getOwnRsvp,
  updateOwnEvent,
} from "@/server/events/events-service";
import { signedEventCoverUrl } from "@/server/events/cover-url";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";

/**
 * `GET /api/v1/events/[eventId]` — the same eight-way assembly
 * `(app)/events/[eventId]/page.tsx` performs, reproduced rather than
 * redesigned: `getEventForViewer` first (a `null` is a 404, on the same
 * indistinguishable-from-"not visible" footing `getConnectionForViewer`
 * documents), then the event's own RSVP, counts, connections-attending, host
 * profile (+ its signed photo), signed cover URL, and the caller's own
 * connection count at this event, all in parallel off the resolved event.
 *
 * WHAT IS DELIBERATELY NOT HERE: `viewerRole`, `publicStats`,
 * `connectionsAttendingLine` and the rest of `events/lib/access-rules.ts`.
 * Those are presentation derivations over these same raw facts — "what should
 * this viewer be shown" — not additional data or an additional check. Every
 * value they need (the event's `host_user_id`, the caller's own `userId` and
 * `ownRsvp`, the counts) is already in this response, so a mobile client
 * derives its own view the same way the web page derives its rendering,
 * rather than this route baking one platform's presentation choices into the
 * wire format both platforms share.
 *
 * `PATCH` is host-only, enforced by `updateOwnEvent`'s own
 * `.eq("host_user_id", userId)` filter plus the RLS policy underneath it —
 * this route adds no host check of its own, matching the belt-and-braces
 * posture the service module already takes.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const { eventId } = await params;
    const { supabase, userId } = context;

    const item = await getEventForViewer(supabase, eventId);
    if (item === null) {
      return Response.json({ ok: false, message: "No such event." }, { status: 404 });
    }
    const { event, city } = item;

    const [ownRsvp, counts, connectionsAttending, host, coverUrl, ownConnectionsHere] =
      await Promise.all([
        getOwnRsvp(supabase, event.id, userId),
        getEventAttendanceCounts(supabase, event.id),
        getConnectionsAttending(supabase, event.id),
        getEventHostProfile(supabase, event.host_user_id),
        signedEventCoverUrl(supabase, event.cover_image_path),
        getOwnConnectionsAtEvent(supabase, event.id, userId),
      ]);

    const hostPhotoUrl = host ? await signedProfilePhotoUrl(supabase, host.photo_path) : null;

    return Response.json({
      ok: true,
      event,
      city,
      ownRsvp,
      counts,
      connectionsAttending,
      host,
      hostPhotoUrl,
      coverUrl,
      ownConnectionsHere,
    });
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/events/[eventId]");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);
    const { eventId } = await params;

    const body = await readJsonBody(request);
    const update = eventUpdateSchema.parse(body);

    await updateOwnEvent(context.supabase, context.userId, eventId, update);

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "PATCH /api/v1/events/[eventId]");
  }
}
