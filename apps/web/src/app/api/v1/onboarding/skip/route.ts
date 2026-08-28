import { apiErrorResponse, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import { assertSignupCompleted } from "@/server/onboarding/onboarding-service";

/**
 * `POST /api/v1/onboarding/skip` — "Skip for now": record that setup is
 * over without writing anything else. Mirrors `skipOnboardingAction`
 * exactly — this is the escape hatch the unconditional onboarding gate
 * makes mandatory, so it has to exist on every platform the gate applies
 * to, not just the one it was built on first.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);

    await assertSignupCompleted(context.userId);

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "POST /api/v1/onboarding/skip");
  }
}
