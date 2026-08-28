import { apiErrorResponse, requireApiContext } from "@/server/api/route-context";
import {
  listCardPreviewActivity,
  listCardTapActivity,
  listOwnAssignedCards,
} from "@/server/activity/activity-service";

/**
 * `GET /api/v1/activity` — the three lists `(app)/activity/page.tsx` renders
 * together: every tap of the caller's own card(s), every non-user preview of
 * their profile, and their own currently-assigned cards (what a revoke
 * action is meaningful for).
 *
 * This is the always-available half of §4.5's detection control — the push
 * notification is the fast half, and both `listCardTapActivity` and
 * `listCardPreviewActivity`'s own headers are explicit that this page is
 * what makes a stolen card or a leaked preview visible to the person it
 * happened to, since a preview in particular produces no tap and therefore
 * no push at all.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const { supabase, userId } = context;

    const [taps, previews, cards] = await Promise.all([
      listCardTapActivity(supabase, userId),
      listCardPreviewActivity(supabase, userId),
      listOwnAssignedCards(supabase, userId),
    ]);

    return Response.json({ ok: true, taps, previews, cards });
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/activity");
  }
}
