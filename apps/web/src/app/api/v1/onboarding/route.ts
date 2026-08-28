import { apiErrorResponse, requireApiContext } from "@/server/api/route-context";
import { hasCompletedSignup } from "@/server/onboarding/onboarding-service";

/**
 * `GET /api/v1/onboarding` — whether the caller has been through onboarding,
 * the same boolean `(app)/layout.tsx`'s gate reads to decide whether to send
 * someone into the flow at all. A mobile client needs the same answer to
 * make the same decision on launch.
 *
 * Read through the caller's own RLS-bound client, matching
 * `hasCompletedSignup`'s own header: the column is granted to
 * `authenticated` and scoped to the caller's own row, so there is nothing
 * here that needs the service role.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const completed = await hasCompletedSignup(context.supabase, context.userId);

    return Response.json({ ok: true, completed });
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/onboarding");
  }
}
