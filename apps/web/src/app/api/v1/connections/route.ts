import { apiErrorResponse, requireApiContext } from "@/server/api/route-context";
import { listOwnConnections } from "@/server/connections/connections-service";

/**
 * `GET /api/v1/connections` — every `active` connection the caller has,
 * exactly as `(app)/connections/page.tsx` renders it. No same-origin check:
 * a read with no side effect, same reasoning as `/api/v1/feed`.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const connections = await listOwnConnections(context.supabase, context.userId);

    return Response.json({ ok: true, connections });
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/connections");
  }
}
