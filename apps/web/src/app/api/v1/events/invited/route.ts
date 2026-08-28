import { apiErrorResponse, requireApiContext } from "@/server/api/route-context";
import { listInvitedEvents } from "@/server/events/events-service";

/**
 * `GET /api/v1/events/invited` — private events the caller was invited to but
 * neither hosts nor has answered for yet. Without this, an invite to a
 * private event is unreachable except by typing its id — see
 * `listInvitedEvents`'s own header for why the event is otherwise invisible
 * to every other listing.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const items = await listInvitedEvents(context.supabase, context.userId);

    return Response.json({ ok: true, items });
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/events/invited");
  }
}
