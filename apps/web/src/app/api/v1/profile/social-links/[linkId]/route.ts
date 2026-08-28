import { socialLinkUpdateSchema } from "@smartcard/types";

import { apiErrorResponse, readJsonBody, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import { deleteOwnSocialLink, updateOwnSocialLink } from "@/server/profile/profile-service";

/**
 * `PATCH /api/v1/profile/social-links/[linkId]`, `DELETE .../[linkId]`.
 *
 * `linkId` comes from the URL and is a value the caller legitimately names —
 * "which of my links" is a normal thing to ask. Ownership is never taken on
 * faith from that: both service functions filter by `user_id` from the
 * AUTHENTICATED context on top of it, so naming somebody else's link id
 * matches zero rows rather than editing a row that isn't the caller's. RLS is
 * still the real backstop underneath both — this filter and this route are
 * defense in depth, exactly as `profile-service.ts`'s header describes for
 * every function in that module.
 *
 * Neither function distinguishes "no such link" from "that link is not
 * yours" — both look identical from here, a `0`-row update — which is the
 * same refusal-equivalence posture the rest of this app takes for anything
 * that could otherwise confirm somebody else's row exists.
 */
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ linkId: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);
    const { linkId } = await params;

    const body = await readJsonBody(request);
    const updates = socialLinkUpdateSchema.parse(body);

    await updateOwnSocialLink(context.supabase, context.userId, linkId, updates);

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "PATCH /api/v1/profile/social-links/[linkId]");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ linkId: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);
    const { linkId } = await params;

    await deleteOwnSocialLink(context.supabase, context.userId, linkId);

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "DELETE /api/v1/profile/social-links/[linkId]");
  }
}
