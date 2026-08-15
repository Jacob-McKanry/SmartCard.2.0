import { redirect } from "next/navigation";
import { LoginLink, RegisterLink } from "@kinde-oss/kinde-auth-nextjs/components";
import { QrCode } from "lucide-react";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { kindeIssuerUrl } from "@/server/env";
import { AuthFailureScreen, classifyAuthFailure } from "@/components/auth-failure-screen";

import { GateActions } from "./gate-actions";

/**
 * The one sign-in screen every gated page in `(app)/` redirects to, replacing
 * five near-identical copies of this same block that used to live one per page
 * (`/profile`, `/feed`, `/connections`, `/connect/present`, `/connect/scan`) —
 * see `(app)/layout.tsx` for the redirect that lands here.
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
 *
 * ---------------------------------------------------------------------------
 * DESIGN PASS — THE GATE (`isGate` in `docs/design/prototypes/Auth flow.dc.html`)
 *
 * WHY THERE IS NO EMAIL FIELD, AND WHY THERE ARE TWO BUTTONS THAT GO TO ONE PAGE
 *
 * Both buttons hand off to the same hosted page, which works out for itself
 * whether the person already exists. That is not a shortcut, it is the security
 * property: a signed-out screen that took an email address and then behaved
 * differently for a known one — a different next step, a different delay, a
 * different error — would be an oracle for "does this person have a SmartCard
 * account", answerable by anyone with a list of email addresses. This screen
 * therefore knows nothing and reveals nothing.
 *
 * WHY THE COPY SHRANK
 *
 * The version this replaces explained the product in two sentences. Nobody
 * reads a paragraph before signing in, and the product explains itself the
 * first time you meet someone; the prototype's note puts the budget at about
 * six words, and one line is what is left.
 *
 * WHAT IS DELIBERATELY NOT HERE: the prototype's `isSignup` screen — our own
 * name-and-email form shown before the handoff — is not built. See the
 * "Auth, failures and Settings" implementation notes in `docs/design/DESIGN.md`
 * for why it cannot be honest yet: nothing in this app can persist a name typed
 * before the account exists, because the row is created from Kinde's verified
 * claims at the first authenticated request and from nothing else.
 */
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  let context;
  try {
    context = await getAuthenticatedContext();
  } catch (error) {
    /*
     * A visitor can reach this page holding a perfectly valid Kinde session
     * that cannot become a SmartCard session — a suspended account is the
     * obvious one. Without this branch the gate 500s for them, and the fallback
     * behaviour (show the gate anyway) would be worse than a crash: they would
     * sign in, be bounced back here, and tap Sign in forever. The three
     * failures that can land here are named screens; anything else is a bug and
     * is re-thrown rather than dressed up as an auth problem.
     */
    const failure = classifyAuthFailure(error);
    if (failure === null) throw error;
    return <AuthFailureScreen failure={failure} />;
  }

  if (context !== null) {
    // Already signed in — the only way here is a stale tab or browser-back
    // after signing in elsewhere, and re-showing a sign-in prompt to someone
    // already signed in is a dead end, not a neutral no-op.
    redirect("/");
  }

  // The host the login endpoint actually redirects to, read from the same
  // variable the SDK builds that redirect from — so the interstitial cannot
  // name one host while the browser goes to another.
  const destinationHost = new URL(kindeIssuerUrl()).host;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[402px] flex-col items-center justify-center gap-[26px] px-[26px] py-10 text-center">
      {/*
       * The app's mark. §2 reserves a full accent field for the Connect CTA and
       * the connection payoff — this is neither, but it is also not a *screen*
       * in that sense: it is a 78px plate, the same object the Connect card
       * carries at card size, and it is the only colour on an otherwise empty
       * page. The shimmer is the prototype's own and is decorative;
       * `prefers-reduced-motion` collapses it globally (see `globals.css`).
       */}
      <span
        aria-hidden
        className="relative flex size-[78px] items-center justify-center overflow-hidden rounded-[26px] text-white"
        style={{
          background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
          boxShadow: "0 20px 44px -14px rgba(11,96,255,.6)",
        }}
      >
        <span
          className="absolute top-[-40%] left-0 h-[180%] w-[36%]"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,.3), transparent)",
            animation: "sc-shimmer 3.8s var(--sc-ease-glide) infinite",
          }}
        />
        <QrCode size={36} strokeWidth={1.8} className="relative" />
      </span>

      <div className="flex flex-col gap-2.5">
        <h1 className="text-[30px] leading-[34px] font-semibold" style={{ letterSpacing: "-.035em" }}>
          SmartCard
        </h1>
        <p className="text-[14px] leading-5" style={{ color: "var(--sc-text-muted)" }}>
          Everyone in here, you met in person.
        </p>
      </div>

      <GateActions
        destinationHost={destinationHost}
        signIn={
          <LoginLink
            postLoginRedirectURL="/"
            className="flex min-h-11 items-center justify-center rounded-full px-4 py-4 text-[15px] leading-[19px] font-semibold text-white"
            style={{
              background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
              boxShadow: "0 16px 32px -12px rgba(11,96,255,.6)",
            }}
          >
            Sign in
          </LoginLink>
        }
        /*
         * No `postLoginRedirectURL` here, unlike `LoginLink` above, and the
         * asymmetry is the SDK's rather than a slip: `LoginLink` rewrites a
         * leading-slash value into an absolute URL before sending it,
         * `RegisterLink` sends it verbatim. A relative value would arrive at
         * Kinde as an unrecognised redirect target. Registration therefore
         * lands wherever `KINDE_POST_LOGIN_REDIRECT_URL` points, which is the
         * same place.
         */
        createAccount={
          <RegisterLink
            className="flex min-h-11 items-center justify-center rounded-full px-4 py-[15px] text-[15px] leading-[19px] font-semibold"
            style={{
              border: "1px solid rgba(13,18,32,.12)",
              background: "rgba(255,255,255,.7)",
              color: "var(--sc-text)",
            }}
          >
            Create an account
          </RegisterLink>
        }
      />
    </main>
  );
}
