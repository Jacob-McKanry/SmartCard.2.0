import { redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { AuthFailureScreen, classifyAuthFailure } from "@/components/auth-failure-screen";
import { hasChosenRosterVisibility } from "@/server/profile/profile-service";

import { RosterVisibilityPrompt } from "./roster-visibility-prompt";

/**
 * The one-time roster-visibility prompt for an account that predates the
 * feature — `docs/architecture/2026-08-27-event-attendee-roster.md` §3.3's
 * third choice surface, alongside the claim-review screen and the
 * onboarding step. See `(app)/layout.tsx`'s "A FIFTH JOB" note for exactly
 * who reaches this page and why the gate ordering guarantees it is never a
 * brand-new signup (they answer during onboarding instead).
 *
 * OUTSIDE THE `(app)` ROUTE GROUP, FOR THE SAME REASON `/onboarding` IS
 *
 * The gate lives in a layout that is never told which path it is
 * rendering, so a gate inside the group it protects would have no way to
 * exempt the one page it redirects to and would send this page to itself
 * forever.
 */
export const dynamic = "force-dynamic";

export default async function RosterVisibilityPage() {
  let context;
  try {
    context = await getAuthenticatedContext();
  } catch (error) {
    const failure = classifyAuthFailure(error);
    if (failure === null) throw error;
    return <AuthFailureScreen failure={failure} />;
  }

  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;

  // Guards the other direction from the gate — someone who already answered
  // (here or via onboarding) can still type this URL or land on it from a
  // stale tab. Re-showing the prompt to someone who already chose would
  // look like the choice did not save.
  if (await hasChosenRosterVisibility(supabase, userId)) {
    redirect("/");
  }

  return <RosterVisibilityPrompt />;
}
