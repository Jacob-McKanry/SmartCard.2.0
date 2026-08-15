import { headers } from "next/headers";

import { resolveCardCodePreview } from "@/server/cards/card-preview-service";
import { vCardRefusalResponse, vCardResponse } from "@/server/cards/vcard";

/**
 * `GET /card/<code>/vcard` — the "Save contact" button on the signed-out card
 * preview.
 *
 * THIS ENDPOINT IS INDEPENDENTLY REACHABLE, SO IT RE-RESOLVES EVERYTHING.
 * It does not trust that the page rendered first, and it takes nothing from
 * the page: it calls `resolveCardCodePreview` itself, with the same code from
 * the same URL, so the card status check, the owner status check, both rate
 * limits and the audit row all happen again. A route handler is a public HTTP
 * endpoint reachable by anyone who can send the request, whether or not they
 * ever loaded a page of ours — the same property `route-helpers.ts` states for
 * the connect endpoints, and the reason there is no cheaper "the page already
 * checked" path here.
 *
 * IT IS A SECOND DISCLOSURE AND IS COUNTED AS ONE. Both budgets are spent
 * again and a second `card_preview_views` row is written with
 * `surface = 'vcard'`. That is not double-counting: the page render and the
 * file download are two separate moments at which somebody's phone number left
 * the building, and the owner's Activity screen is more useful for being able
 * to tell them apart. The seeded limits are sized on that basis
 * (20260815120000).
 *
 * NO AUTH CHECK, DELIBERATELY. A signed-in visitor never reaches this — the
 * page they see is the redeem flow, which has no download button — but nothing
 * stops one requesting this URL directly, and refusing them would be a
 * distinction without a purpose: a signed-in user who taps this card is about
 * to be connected to its owner and can see all of this and more. Adding an
 * auth branch would mean this endpoint behaved differently for two callers,
 * which is one more thing that can leak than zero.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params;

  const preview = await resolveCardCodePreview(code, {
    headers: await headers(),
    surface: "vcard",
  });

  // One refusal, no reason, identical to the QR route's — see
  // `vCardRefusalResponse`.
  if (preview === null) {
    return vCardRefusalResponse();
  }

  return vCardResponse(preview);
}
