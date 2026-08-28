import { apiErrorResponse, requireApiContext } from "@/server/api/route-context";
import { listFeedItems } from "@/server/feed/feed-service";

/**
 * `GET /api/v1/feed` — every meeting the caller is entitled to see, per RLS,
 * exactly as `(app)/feed/page.tsx` renders it. No same-origin check: this is
 * a read with no side effect, same reasoning as `/api/v1/me` and `GET
 * /api/v1/profile`.
 *
 * No pagination parameter here, matching the service: `listFeedItems` caps at
 * `FEED_ITEM_LIMIT` internally and the web screen has no "load more" either.
 * Adding one is a real feature, not a mobile-parity line item, and belongs in
 * its own change against the service function both platforms would then share.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const items = await listFeedItems(context.supabase, context.userId);

    return Response.json({ ok: true, items });
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/feed");
  }
}
