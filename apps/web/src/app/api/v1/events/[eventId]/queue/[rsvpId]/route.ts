import { rsvpDecisionSchema } from "@smartcard/types";

import { apiErrorResponse, readJsonBody, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import { decideRsvp } from "@/server/events/events-service";

/**
 * `PATCH /api/v1/events/[eventId]/queue/[rsvpId]` — a host approving or
 * denying one request.
 *
 * `eventId` is in the URL for a REST shape that matches
 * `GET .../queue`'s listing, not because `decideRsvp` needs it: the RPC looks
 * the RSVP up joined to its own event and checks `host_user_id = caller`
 * itself, answering `rsvp_not_found` for both "no such RSVP" and "not your
 * event" — `events-service.ts`'s own comment on why that cannot be used to
 * probe whether an id is real. This route does not re-derive or re-check
 * which event the RSVP belongs to; the database is the only place that
 * question is answered.
 *
 * `override` defaults to `false` and is optional in the body — a host
 * approving within capacity never needs to think about it.
 */
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string; rsvpId: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);
    const { rsvpId } = await params;

    const body = (await readJsonBody(request)) as { decision?: unknown; override?: unknown };
    const decision = rsvpDecisionSchema.safeParse(body.decision);
    if (!decision.success) {
      return Response.json(
        { ok: false, message: "decision must be one of: approve, deny." },
        { status: 400 },
      );
    }
    const override = body.override === true;

    const result = await decideRsvp(context.supabase, rsvpId, decision.data, override);

    return Response.json({ ok: true, result });
  } catch (error) {
    return apiErrorResponse(error, "PATCH /api/v1/events/[eventId]/queue/[rsvpId]");
  }
}
