import { apiErrorResponse, requireApiContext } from "@/server/api/route-context";
import { getHostRsvpQueue } from "@/server/events/events-service";

/**
 * `GET /api/v1/events/[eventId]/queue` — the host's roster: everyone
 * `pending`, `waitlist` or `going`. No host check here — the RPC returns an
 * empty list for anybody who is not the host, per `getHostRsvpQueue`'s own
 * contract, and this route passes that straight through rather than adding a
 * second, weaker copy of the same rule.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const { eventId } = await params;

    const entries = await getHostRsvpQueue(context.supabase, eventId);

    return Response.json({ ok: true, entries });
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/events/[eventId]/queue");
  }
}
