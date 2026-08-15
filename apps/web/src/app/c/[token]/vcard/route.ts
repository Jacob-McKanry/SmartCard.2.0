import { headers } from "next/headers";

import { resolveQrTokenPreview } from "@/server/cards/card-preview-service";
import { vCardRefusalResponse, vCardResponse } from "@/server/cards/vcard";

/**
 * `GET /c/<token>/vcard` — the "Save contact" button on the QR landing page.
 *
 * The twin of `/card/<code>/vcard`, and deliberately its exact shape: it
 * re-resolves from scratch rather than trusting that the page rendered first,
 * it spends budget and writes its own audit row (`surface = 'vcard'`), and it
 * refuses through the same shared `vCardRefusalResponse` so that a forged
 * token, an expired one and a consumed session are indistinguishable from each
 * other and from an unknown card code on the other route.
 *
 * ONE THING IS WORTH NOTING ABOUT TIMING. The token has a 45-second life and
 * the nonce rotates every 30, so a visitor who lingers on the preview before
 * tapping "Save contact" can find the download refused even though the page
 * they are looking at rendered fine. That is the correct behaviour and not a
 * race to paper over: the freshness window is what makes a photographed QR
 * useless (§4.7 threat 1), and carving out an exception for the download —
 * caching the resolved preview, say, or accepting a stale nonce here only —
 * would reopen exactly that window on this surface. The visitor's remedy is
 * the same as the scanner's: ask them to show the code again.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  const preview = await resolveQrTokenPreview(token, {
    headers: await headers(),
    surface: "vcard",
  });

  if (preview === null) {
    return vCardRefusalResponse();
  }

  return vCardResponse(preview);
}
