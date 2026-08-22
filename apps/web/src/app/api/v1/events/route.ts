import { eventInsertSchema } from "@smartcard/types";

import { apiErrorResponse, readJsonBody, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import { browseEvents, createEvent } from "@/server/events/events-service";

/**
 * `GET /api/v1/events` — the public directory, `POST /api/v1/events` — create.
 *
 * `GET`'s query params mirror `BrowseEventsOptions` exactly: `city` (a city
 * id) and `when` (`upcoming` default, or `past`). `.eq("visibility",
 * "public")` inside `browseEvents` is a product filter, not a security one —
 * see that function's own comment — so this route adds no extra scoping of
 * its own on top of it.
 *
 * `POST`'s `hostUserId` comes from the authenticated context, never the body
 * — `createEvent`'s own header explains why that argument is separate: the
 * INSERT policy's `with check` would refuse a mismatch anyway, but passing it
 * explicitly produces a clearer failure than a policy violation, and gives a
 * schema no field to be tempted to trust.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await requireApiContext(request);
    const url = new URL(request.url);
    const cityId = url.searchParams.get("city") ?? undefined;
    const whenParam = url.searchParams.get("when");
    const when = whenParam === "past" ? "past" : "upcoming";

    const items = await browseEvents(context.supabase, { cityId, when });

    return Response.json({ ok: true, items });
  } catch (error) {
    return apiErrorResponse(error, "GET /api/v1/events");
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);

    const body = await readJsonBody(request);
    const input = eventInsertSchema.parse(body);

    const event = await createEvent(context.supabase, context.userId, input);

    return Response.json({ ok: true, event }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "POST /api/v1/events");
  }
}
