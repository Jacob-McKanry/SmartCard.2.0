import { userProfileUpdateSchema } from "@smartcard/types";

import { apiErrorResponse, readJsonBody, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import { getOwnProfile, updateOwnProfile, type OwnProfile } from "@/server/profile/profile-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";

/**
 * `GET /api/v1/profile`, `PATCH /api/v1/profile` — the mobile door onto
 * `profile-service.ts`, which named this exact shape as its intended future
 * home: "the natural home for this logic is a Route Handler that both
 * platforms' `packages/api-client` calls into... this module is already
 * shaped to move behind one with no change to its signatures, since it takes
 * a plain `SupabaseClient` rather than anything web-specific." This route adds
 * no logic of its own — auth, then one service call, then the response.
 *
 * WHY `photoUrl` IS ADDED HERE RATHER THAN LEFT TO THE CLIENT
 *
 * `photo_path` is a Storage key, not a URL — resolving it into something an
 * `<Image>` can load requires an RLS-bound `createSignedUrl` call, which needs
 * server credentials a mobile client does not have. `(app)/profile/page.tsx`
 * does the same pairing (`getOwnProfile` + `signedProfilePhotoUrl`) for the
 * web screen; this route reproduces that pairing rather than inventing a
 * different shape for the same data. A failed signing degrades to `null`
 * (`signedProfilePhotoUrl`'s own contract) — never a failed response over a
 * missing avatar.
 *
 * WHY `PATCH` VALIDATES BEFORE CALLING THE SERVICE, EVEN THOUGH THE SERVICE
 * VALIDATES TOO
 *
 * `updateOwnProfile` runs `userProfileUpdateSchema.parse()` internally as a
 * backstop — belt-and-braces, the same posture the service module documents
 * for its RLS filters. Parsing here first is not redundant: it is what lets
 * this route return the SPECIFIC issue ("username must be at most 32
 * characters") instead of the generic collapse a route-level throw would
 * produce. `(app)/profile/actions.ts` does exactly this for the same reason
 * (`firstIssue`) — a validation message about the caller's OWN submitted
 * field is safe to show verbatim (`errors.ts`'s rule), unlike a database
 * error, which is why this is the one place a route deliberately parses ahead
 * of the function it is about to call anyway.
 */
export const dynamic = "force-dynamic";

interface ProfileResponse {
  profile: OwnProfile;
  photoUrl: string | null;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const profile = await getOwnProfile(context.supabase, context.userId);
    const photoUrl = await signedProfilePhotoUrl(context.supabase, profile.photo_path);

    return Response.json({ ok: true, profile, photoUrl } satisfies { ok: true } & ProfileResponse);
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/profile");
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);

    const body = await readJsonBody(request);
    // `.parse()` throws `ZodError`, which `apiErrorResponse` renders as the
    // caller's own first issue — see the header for why that is safe here and
    // is not the generic-collapse path everything else takes.
    const updates = userProfileUpdateSchema.parse(body);

    await updateOwnProfile(context.supabase, context.userId, updates);

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "PATCH /api/v1/profile");
  }
}
