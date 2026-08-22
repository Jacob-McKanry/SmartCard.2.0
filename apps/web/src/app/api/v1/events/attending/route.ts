import { apiErrorResponse, requireApiContext } from "@/server/api/route-context";
import { listAttendingEvents } from "@/server/events/events-service";

/** `GET /api/v1/events/attending` — every event the caller has answered for, with their answer. */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const items = await listAttendingEvents(context.supabase, context.userId);

    return Response.json({ ok: true, items });
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/events/attending");
  }
}
