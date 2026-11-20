import type { Metadata } from "next";

import { AppShell } from "./(app)/app-shell";
import { HomeScreen } from "./(app)/home-screen";
import { LandingPage } from "./_landing/landing-page";

/**
 * `/` — smartcard.tech's front door, serving two audiences from one URL.
 *
 *  - Signed out: the public landing page (`_landing/landing-page.tsx`).
 *  - Signed in: the Home screen, inside the same app shell every other
 *    signed-in screen uses (nav, onboarding redirect, auth failure screens).
 *
 * WHY ONE URL RATHER THAN MOVING HOME TO `/home`
 *
 * `/` is already where members land: the sign-in screen's post-login
 * redirect, the onboarding flow's finish, the nav's Home tab, the connect
 * payoff's "Done" button and Kinde's configured redirect all point here.
 * Moving Home would mean changing every one of those (one of them lives in
 * Kinde's dashboard, outside this repo) and sending each member through an
 * extra redirect. Keeping `/` and choosing what to render by session changes
 * nothing for a member.
 *
 * WHY THIS FILE IS OUTSIDE THE `(app)` ROUTE GROUP
 *
 * The `(app)` layout redirects every signed-out request to `/sign-in`, so a
 * page inside it can never show anything to a visitor. Outside the group,
 * this page runs the identical gate through `AppShell` and passes the landing
 * page as the signed-out branch. `HomeScreen` is only rendered — and so only
 * executes its queries — once that gate has passed; see `AppShell`'s header.
 *
 * Underscored `_landing/` is a Next.js private folder: it is never a route of
 * its own, so the landing page is reachable only here.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SmartCard — Everyone in here, you met in person",
  description:
    "A private social network you can only grow face to face. Tap a card or scan a live code to connect. No search, no followers, no ads.",
};

export default function RootPage() {
  return (
    <AppShell signedOut={<LandingPage />}>
      <HomeScreen />
    </AppShell>
  );
}
