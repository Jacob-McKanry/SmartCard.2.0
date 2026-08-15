import { headers } from "next/headers";

import { resolveQrTokenPreview } from "@/server/cards/card-preview-service";
import { NonUserPreview, PreviewNotFound } from "@/components/non-user-preview";

/**
 * `/c/[token]` — the URL a presenter's QR code actually encodes.
 *
 * ===========================================================================
 * THIS ROUTE DID NOT EXIST, AND THAT WAS A BUG NOBODY HAD HIT YET
 * ===========================================================================
 *
 * `connect/lib/qr-url.ts` has always built the QR's contents as
 * `<origin>/c/<token>` (§4.2 step 2, `CONNECT_PATH_PREFIX = "/c/"`), and the
 * in-app scanner parses that shape back out before POSTing to
 * `/api/connect/qr/redeem`. That loop is complete and works. What did not work
 * is the other way a QR code gets read in the real world: a phone camera. Point
 * one at a SmartCard QR and it offers to open the URL — and until this file
 * existed the URL 404'd. The presenter's screen was showing a link to nothing.
 *
 * WHAT THIS PAGE IS, AND WHAT IT IS EMPHATICALLY NOT. It is a read-only preview
 * of the presenter's contact details for somebody with no account, plus a vCard
 * and a sign-in link. It creates no connection and offers no way to create one.
 * A connection through the QR path requires a live GPS fix from the scanner
 * compared server-side against the presenter's (§4.3), and this page collects
 * no location and never will — the moment it did, it would be a second,
 * weaker, unauthenticated path into the social graph, which is precisely what
 * §4.7 threat 4's instruction forbids.
 *
 * NO AUTH CHECK AT ALL, AND WHY THAT IS THE SIMPLE ANSWER RATHER THAN A LAZY
 * ONE. A signed-in user who lands here is somebody who scanned with their
 * camera instead of the app; they see the same preview, and the way they
 * connect is unchanged (open the app's scanner, which collects the fix this
 * page cannot). Branching on auth would add a Kinde round trip to a page whose
 * whole audience is people without accounts, and would give the route two
 * behaviours where one will do.
 *
 * WHY A STALE OR FORGED TOKEN IS INDISTINGUISHABLE FROM A REAL ONE THAT JUST
 * EXPIRED. `resolveQrTokenPreview` runs §4.2 step 5's first five checks —
 * signature, `exp`, live session, session lifetime, nonce — and returns the
 * same `null` for every failure, which renders the same `PreviewNotFound` as an
 * unknown card code does on the other route. A screenshot of somebody's QR
 * taken two rotations ago shows nothing, exactly as it would to the scanner.
 */
export const dynamic = "force-dynamic";

export default async function ConnectTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const preview = await resolveQrTokenPreview(token, {
    headers: await headers(),
    surface: "preview",
  });

  if (preview === null) {
    return <PreviewNotFound />;
  }

  return (
    <NonUserPreview
      preview={preview}
      actions={{
        vcardHref: `/c/${encodeURIComponent(token)}/vcard`,
        // Home, not back here. Unlike a card code — which is permanent, so
        // returning to it after sign-in still redeems the tap — this token is
        // dead within `qr_token_ttl_seconds` (45s). Sending somebody back to it
        // after a sign-up flow would land them on "Nothing here" and read as a
        // broken product rather than as an expired code.
        postLoginRedirectUrl: "/",
        signInBlurb:
          "Already on SmartCard? Sign in, then scan this code again from inside the app — connections are only made in person, and the app checks you are both actually here.",
      }}
    />
  );
}
