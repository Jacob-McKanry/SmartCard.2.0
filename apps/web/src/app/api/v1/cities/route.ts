import { apiErrorResponse, requireApiContext } from "@/server/api/route-context";
import { listActiveCities } from "@/server/events/events-service";

/** `GET /api/v1/cities` — the curated city picker list, active cities only. */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const cities = await listActiveCities(context.supabase);

    return Response.json({ ok: true, cities });
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/cities");
  }
}
