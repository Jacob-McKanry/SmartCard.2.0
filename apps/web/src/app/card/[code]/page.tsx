import { headers } from "next/headers";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { resolveCardCodePreview } from "@/server/cards/card-preview-service";
import { NonUserPreview, PreviewNotFound } from "@/components/non-user-preview";

import { CardRedeemFlow } from "./card-redeem-flow";

/**
 * `/card/[code]` — the exact route shape a tapped SmartCard's URL resolves
 * to. §2.2: every physical card is permanently encoded with
 * `https://smartcard.tech/card/<code>`, confirmed by tapping a real card —
 * this route is not a preview or a stand-in for a future native handoff, it
 * is the actual destination a tap lands on today.
 *
 * WHY THERE IS NO UNIVERSAL/APP-LINK HANDOFF HERE (§7.3)
 * §7.3 is about `smartcard.tech` serving `.well-known/apple-app-site-
 * association` and `assetlinks.json` so a tap opens a *native app* instead
 * of the browser. There is no native app yet — mobile Kinde auth hasn't even
 * been wired (see README's "Next up"). Until an app exists to hand off to,
 * this web page is the correct, complete destination, not a stopgap
 * building toward one; adding `.well-known` placeholder files now would be
 * scope for a capability this codebase doesn't have.
 *
 * SIGNED-IN: AUTO-TRIGGERS, NO EXTRA TAP — UNCHANGED BY THE PREVIEW WORK
 * `CardRedeemFlow` fires `POST /api/connect/nfc/redeem` the instant it
 * mounts — see its header for why a tap's whole product value is a near-zero
 * -friction gesture, and a confirmation button here would just be Q17's
 * rejected confirmation step reintroduced as UI. Nothing below touches that
 * path; the preview is for signed-out visitors only.
 *
 * ===========================================================================
 * SIGNED-OUT: A PREVIEW, WHERE THIS FILE USED TO RENDER A STATIC PROMPT
 * ===========================================================================
 *
 * This reverses what this file previously said at length, and the reversal is
 * worth stating rather than leaving a reader to infer it from a diff.
 *
 * WHAT IT USED TO DO. Render a fixed sign-in prompt and touch the database
 * zero times, on the grounds that the non-user flow was deferred past the
 * pilot (§2.8). That had a property nobody wrote down but which was real:
 * `/card/<a real code>` and `/card/<garbage>` returned byte-identical pages, so
 * the route could not tell anybody whether a code existed.
 *
 * WHAT IT DOES NOW, AND WHY. A signed-out visitor sees the cardholder's name,
 * company, role, bio, phone number, email and photo, plus a vCard download and
 * a sign-in link. The project owner made this call with the consequences set
 * out in full: preview is on for every assigned, active card, there is no
 * opt-out column, and contact details are included by default. The product
 * reason is that a physical card handed to somebody without the app previously
 * did nothing whatsoever — the tap landed on a wall.
 *
 * WHAT IT COSTS, STATED PLAINLY RATHER THAN BURIED. The property above is
 * gone. This route now answers "is this a real, live card?" to anyone who
 * asks, and answers it with a person's contact details. Three things bound the
 * damage and none of them restores that property:
 *
 *   * The code itself. §2.2/Q1: 48 bits of non-user-chosen randomness, unique
 *     across all 7,142 cards. Guessing is not a search that finishes, so the
 *     enumeration that matters is by somebody who already HAS a list of codes,
 *     not somebody generating them.
 *   * Two rate limits with no user behind them, per IP and per card
 *     (20260815120000) — because the per-user budget that resists exactly this
 *     on the redeem path does not exist for an anonymous caller.
 *   * One audit row per disclosure (`card_preview_views`), surfaced on
 *     `/activity`, so a card that IS enumerated is not invisible to its owner.
 *
 * The residual — a permanent, forwardable URL that now resolves to a profile
 * with contact details, so screenshot-and-forward is no longer pointless on
 * this path — is recorded as an amendment to §4.7 threat 1 rather than only
 * living in this comment.
 *
 * EVERY REFUSAL LOOKS THE SAME. Unknown code, unassigned stock, a revoked
 * card, a suspended owner, an exhausted budget, a missing config row and any
 * thrown error all produce one `null` from the service and one
 * `PreviewNotFound` here.
 */
export const dynamic = "force-dynamic";

export default async function CardPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const context = await getAuthenticatedContext();

  if (context !== null) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6 sm:p-10">
        <header className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-xl font-semibold">SmartCard</h1>
        </header>
        <CardRedeemFlow code={code} />
      </main>
    );
  }

  const preview = await resolveCardCodePreview(code, {
    headers: await headers(),
    surface: "preview",
  });

  if (preview === null) {
    return <PreviewNotFound />;
  }

  // The self-redirect this route has always had, and the reason `/card/[code]`
  // sits outside the `(app)` route group at all: a tap that loses its code to a
  // generic post-login landing page has lost the entire point of tapping.
  const selfUrl = `/card/${encodeURIComponent(code)}`;

  return (
    <NonUserPreview
      preview={preview}
      actions={{
        vcardHref: `${selfUrl}/vcard`,
        postLoginRedirectUrl: selfUrl,
        signInBlurb:
          "Already on SmartCard? Sign in and this tap finishes connecting you. Connections only ever happen in person — there is no way to add somebody from a link.",
      }}
    />
  );
}
