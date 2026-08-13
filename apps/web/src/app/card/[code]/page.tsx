import { LoginLink } from "@kinde-oss/kinde-auth-nextjs/components";

import { getAuthenticatedContext } from "@/server/auth/current-user";

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
 * SIGNED-IN: AUTO-TRIGGERS, NO EXTRA TAP
 * `CardRedeemFlow` fires `POST /api/connect/nfc/redeem` the instant it
 * mounts — see its header for why a tap's whole product value is a near-zero
 * -friction gesture, and a confirmation button here would just be Q17's
 * rejected confirmation step reintroduced as UI.
 *
 * SIGNED-OUT: SIGN-IN PROMPT ONLY — THE FULL NON-USER FLOW IS OUT OF SCOPE
 * README lists "the non-user landing/pending-connection flow" as deferred
 * past the first pilot (Phase 2 fast-follow): a profile preview, a vCard
 * download, and capturing a pending connection to complete once the tapper
 * signs up. None of that exists anywhere in this codebase yet, and building
 * any part of it here — even a stripped-down preview — would be scope
 * invented ahead of what the product spec actually calls for at this build
 * order position. A signed-out visitor gets the same sign-in prompt pattern
 * every other Connect Flow screen uses (`/profile`, `/connect/present`,
 * `/connect/scan`), with `postLoginRedirectURL` pointed back at this exact
 * `/card/[code]` URL so the tap that brought them here still redeems after
 * they sign in — the code is not lost the way it would be if sign-in landed
 * them on a generic home page instead.
 */
export const dynamic = "force-dynamic";

export default async function CardPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const context = await getAuthenticatedContext();

  if (context === null) {
    const redirectUrl = `/card/${encodeURIComponent(code)}`;
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">Sign in to connect</h1>
        <p className="text-sm text-muted-foreground">
          You tapped a SmartCard. Sign in to complete the connection with whoever it belongs to.
        </p>
        <LoginLink postLoginRedirectURL={redirectUrl}>
          <span className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
            Sign in with Kinde
          </span>
        </LoginLink>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6 sm:p-10">
      <header className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold">SmartCard</h1>
      </header>
      <CardRedeemFlow code={code} />
    </main>
  );
}
