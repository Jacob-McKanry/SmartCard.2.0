import { redirect } from "next/navigation";
import { LoginLink } from "@kinde-oss/kinde-auth-nextjs/components";

import { getAuthenticatedContext } from "@/server/auth/current-user";

/**
 * The one sign-in screen every gated page in `(app)/` now redirects to,
 * replacing five near-identical copies of this same block that used to live
 * one per page (`/profile`, `/feed`, `/connections`, `/connect/present`,
 * `/connect/scan`) — see `(app)/layout.tsx` for the redirect that lands here.
 *
 * WHY THIS LOST EACH PAGE'S "COME BACK TO EXACTLY HERE" REDIRECT
 *
 * The old per-page versions each set `postLoginRedirectURL` to their own
 * path. A shared layout has no reliable way to learn which page triggered
 * it — Next.js does not hand a layout the request pathname — so preserving
 * that per-page precision would mean threading the path through some other
 * channel for a small UX nicety. Landing everyone on `/` (the home screen)
 * after sign-in is a deliberate trade for a single, simple, correct gate
 * instead. `/card/[code]` is a real exception with real stakes — a lost NFC
 * tap loses the whole point of tapping — so it keeps its own self-redirect
 * outside this group entirely; see that page's header.
 *
 * WHY THIS PAGE ITSELF ISN'T INSIDE `(app)/`
 *
 * The `(app)` layout redirects signed-out visitors here. Putting this page
 * inside that same group would mean its own layout redirects it right back
 * to itself — an infinite loop, not a gate.
 */
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const context = await getAuthenticatedContext();
  if (context !== null) {
    // Already signed in — the only way here is a stale tab or browser-back
    // after signing in elsewhere, and re-showing a sign-in prompt to someone
    // already signed in is a dead end, not a neutral no-op.
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Sign in to SmartCard</h1>
      <p className="text-sm text-muted-foreground">
        SmartCard connections only happen through an in-person tap or scan — sign in to see who
        you&rsquo;ve met and share the code that makes the next one.
      </p>
      <LoginLink postLoginRedirectURL="/">
        <span className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90">
          Sign in with Kinde
        </span>
      </LoginLink>
    </main>
  );
}
