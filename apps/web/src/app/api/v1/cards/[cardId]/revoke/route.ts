import { apiErrorResponse, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import { revokeCard } from "@/server/cards/cards-service";

/**
 * `POST /api/v1/cards/[cardId]/revoke` — the lost-or-stolen-card kill switch
 * §4.5 names. An action-shaped route (`POST .../revoke`) rather than a
 * generic `PATCH /api/v1/cards/[cardId]` with a status field, matching
 * `revokeCard`'s own shape: it is one fixed transition
 * (`assigned -> revoked`), not an arbitrary status write, and the RLS
 * `with check` behind it permits only that direction from a client — a
 * generic status field would invite a body that names a transition the
 * database was always going to refuse anyway, for no benefit.
 *
 * `revokeCard` scopes by both `cardId` and the caller's own id, on top of
 * the RLS policy underneath it — the same belt-and-braces posture every
 * other service module in this app takes. A card that is not the caller's,
 * or is already revoked, surfaces as `revokeCard`'s own `UserFacingError`
 * rather than a distinct status here.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cardId: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);
    const { cardId } = await params;

    await revokeCard(context.supabase, cardId, context.userId);

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "POST /api/v1/cards/[cardId]/revoke");
  }
}
