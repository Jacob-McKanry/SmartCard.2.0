import { cardCodeSchema } from "@smartcard/types";

import { apiErrorResponse, readJsonBody, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import { claimUnassignedCard } from "@/server/cards/card-claim-service";
import { UserFacingError } from "@/server/errors";

/**
 * `POST /api/v1/cards/claim` — the mobile door onto `claim_unassigned_card`
 * (20260821120000), matching `apps/web/src/app/card/[code]/actions.ts`'s
 * `claimCardAction` exactly, including its one-message-for-every-refusal
 * posture.
 *
 * WHY THIS ROUTE VALIDATES THE CODE'S SHAPE AND NOTHING ELSE
 *
 * All of the real work — resolving the code, refusing `assigned` and
 * `revoked`, both rate limits, the atomic transition — happens inside the
 * `security definer` RPC, which is directly callable over PostgREST by
 * anyone holding a session and therefore cannot rely on this route (or any
 * caller) to have checked anything. See the migration's own header for why
 * that placement is deliberate. `cardCodeSchema` here is the same shape
 * filter the RPC repeats internally — its only job is that garbage does not
 * become a round trip.
 *
 * WHY A REFUSAL IS ONE MESSAGE, NEVER A REASON
 *
 * `claimUnassignedCard` answers `{ claimed: boolean }` and nothing else, by
 * design (`CardClaimResult`'s own header): an unknown code, a revoked one,
 * and one somebody else already owns are all indistinguishable on purpose,
 * so a claim attempt cannot be used to tell them apart. This route has
 * nothing to add to that and does not try to.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);

    const body = (await readJsonBody(request)) as { code?: unknown };
    const parsed = cardCodeSchema.safeParse(body.code);
    if (!parsed.success) {
      return Response.json({ ok: false, message: "That doesn't look like a SmartCard code." }, { status: 400 });
    }

    const { claimed } = await claimUnassignedCard(context.supabase, parsed.data);

    if (!claimed) {
      throw new UserFacingError(
        "This card couldn't be claimed. If somebody just handed it to you, check the code and try again.",
      );
    }

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "POST /api/v1/cards/claim");
  }
}
