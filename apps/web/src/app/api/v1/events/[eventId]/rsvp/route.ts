import { rsvpIntentSchema } from "@smartcard/types";

import { apiErrorResponse, readJsonBody, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import { requestRsvp, withdrawRsvp } from "@/server/events/events-service";

/**
 * `POST /api/v1/events/[eventId]/rsvp` — express an intent (`going` /
 * `interested` / `not_going`). `DELETE .../rsvp` — withdraw entirely.
 *
 * Both are RPCs under the hood (`request_event_rsvp`,
 * `withdraw_event_rsvp`), and both answer with an ordinary
 * `RsvpMutationResult` — `{ ok: true, status, ... }` or `{ ok: false, reason
 * }` — rather than throwing, mirroring the connect endpoints' "a refusal is
 * a normal answer, not an exception" posture (§4.2 step 7). This route
 * passes that result straight through with `ok: true` at the HTTP level in
 * both cases: an event being full or requiring approval is not a request
 * failure, it is the RPC doing its job, and `events-service.ts`'s own
 * comment is explicit that callers must render the RETURNED status, not the
 * intent they sent — `going` sent to a full event legitimately comes back
 * `waitlist`.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);
    const { eventId } = await params;

    const body = await readJsonBody(request);
    const parsed = rsvpIntentSchema.safeParse((body as { intent?: unknown }).intent);
    if (!parsed.success) {
      return Response.json(
        { ok: false, message: "intent must be one of: going, interested, not_going." },
        { status: 400 },
      );
    }

    const result = await requestRsvp(context.supabase, eventId, parsed.data);

    return Response.json({ ok: true, result });
  } catch (error) {
    return apiErrorResponse(error, "POST /api/v1/events/[eventId]/rsvp");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);
    const { eventId } = await params;

    const result = await withdrawRsvp(context.supabase, eventId);

    return Response.json({ ok: true, result });
  } catch (error) {
    return apiErrorResponse(error, "DELETE /api/v1/events/[eventId]/rsvp");
  }
}
