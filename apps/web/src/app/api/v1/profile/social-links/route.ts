import { socialLinkInsertSchema } from "@smartcard/types";

import { apiErrorResponse, readJsonBody, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import { addOwnSocialLink, listOwnSocialLinks } from "@/server/profile/profile-service";

/**
 * `GET /api/v1/profile/social-links`, `POST /api/v1/profile/social-links`.
 *
 * `user_id` is never read from the body — `addOwnSocialLink` sets it from the
 * authenticated caller (`profile-service.ts`'s own header: a client that could
 * supply its own `user_id` could attach a link to somebody else's profile),
 * and `socialLinkInsertSchema` is `.strict()` specifically so a body that
 * tries to include one is rejected here, at validation, rather than silently
 * dropped and proceeding.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const links = await listOwnSocialLinks(context.supabase, context.userId);

    return Response.json({ ok: true, links });
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/profile/social-links");
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);

    const body = await readJsonBody(request);
    const input = socialLinkInsertSchema.parse(body);

    const link = await addOwnSocialLink(context.supabase, context.userId, input);

    return Response.json({ ok: true, link }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "POST /api/v1/profile/social-links");
  }
}
