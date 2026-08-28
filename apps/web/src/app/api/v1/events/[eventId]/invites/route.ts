import { uuidSchema } from "@smartcard/types";

import { apiErrorResponse, readJsonBody, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import { inviteToEvent, listEventInvites } from "@/server/events/events-service";

/**
 * `GET /api/v1/events/[eventId]/invites`, `POST .../invites`.
 *
 * `GET` has no ownership filter and no role check here, matching
 * `listEventInvites`'s own posture: RLS already scopes the answer to
 * whatever the caller may see (a host's own event's invites, an inviter's
 * own sent invites, an invitee's own received invite, or an empty list for
 * anyone else), and re-checking any of that here would only add a second,
 * weaker copy of the same rule.
 *
 * `POST`'s `invitedByUserId` is the authenticated caller, never the body —
 * same reasoning as `createEvent`'s `hostUserId`. The INSERT policy is the
 * real gate (only the host or a `going` guest may invite, and only an
 * existing connection may be invited); this route validates only that
 * `invitedUserId` is shaped like an id, and lets the policy refuse
 * everything it is meant to refuse.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const { eventId } = await params;

    const invites = await listEventInvites(context.supabase, eventId);

    return Response.json({ ok: true, invites });
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/events/[eventId]/invites");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);
    const { eventId } = await params;

    const body = (await readJsonBody(request)) as { invitedUserId?: unknown };
    const invitedUserId = uuidSchema.safeParse(body.invitedUserId);
    if (!invitedUserId.success) {
      return Response.json({ ok: false, message: "invitedUserId must be a user id." }, { status: 400 });
    }

    await inviteToEvent(context.supabase, eventId, context.userId, invitedUserId.data);

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "POST /api/v1/events/[eventId]/invites");
  }
}
