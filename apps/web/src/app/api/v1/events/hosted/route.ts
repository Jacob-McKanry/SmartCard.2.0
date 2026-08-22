import { apiErrorResponse, requireApiContext } from "@/server/api/route-context";
import { listHostedEvents } from "@/server/events/events-service";

/** `GET /api/v1/events/hosted` — events the caller hosts, including private ones. */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const items = await listHostedEvents(context.supabase, context.userId);

    return Response.json({ ok: true, items });
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/events/hosted");
  }
}
