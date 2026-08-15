import { redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { AuthFailureScreen, classifyAuthFailure } from "@/components/auth-failure-screen";
import { getOwnProfile } from "@/server/profile/profile-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";
import { hasCompletedSignup } from "@/server/onboarding/onboarding-service";

import { OnboardingFlow } from "./onboarding-flow";

/**
 * Onboarding — `isOnbPhoto` and `isOnbDetails` in
 * `docs/design/prototypes/Auth flow.dc.html`, finally buildable now that
 * `users.has_completed_signup` has a writer (see
 * `server/onboarding/onboarding-service.ts` and 20260815130000).
 *
 * ============================================================================
 * WHY THIS ROUTE IS OUTSIDE THE `(app)` GROUP
 * ============================================================================
 *
 * The gate that sends people here lives in `(app)/layout.tsx`, and a layout is
 * not told which path it is rendering — the same limitation `sign-in/page.tsx`
 * records for its own redirect. So a gate inside the group would have no way to
 * exempt the one page it redirects TO, and would send this page to itself
 * forever. Sitting outside the group is what makes the gate a single
 * unconditional line instead of a path comparison in the wrong place.
 *
 * It also matches what the screens are: full-bleed, no dock, nothing to
 * navigate to yet. The prototype draws them with no tab bar for the same
 * reason.
 *
 * ============================================================================
 * WHO SEES THIS, AND WHO NEVER WILL
 * ============================================================================
 *
 * Only accounts created after 20260815130000. That migration backfills
 * `has_completed_signup = true` for every row that existed when it ran — all
 * 337 migrated legacy members and everybody who signed in during the build — so
 * their first sign-in after this ships is unchanged. §5.1's pilot notes want a
 * returning member to "feel like a return rather than a signup", and the
 * cheapest way to guarantee that was to make it structurally impossible for
 * them to be asked.
 *
 * ============================================================================
 * WHY EVERY STEP CAN BE SKIPPED, AND WHY SKIPPING STILL COUNTS AS FINISHING
 * ============================================================================
 *
 * The prototype labels the whole details screen "All optional, all editable
 * later" and puts a Skip beside the photo. That is not politeness: nothing
 * collected here is required by any column, any policy or any feature — a
 * profile with nothing on it works, and the card preview and the connection
 * screens all degrade to initials and an email.
 *
 * Which makes the escape hatch a correctness requirement rather than a
 * courtesy. The gate is unconditional, so if there were a way to reach the end
 * of this flow without the flag being written, the person would be returned
 * here on every navigation, forever, with no way out and nothing they could
 * type to change it. Both exits — "Done" and "Skip for now" — therefore assert
 * completion. Skipping IS finishing, because there was nothing that had to be
 * done.
 *
 * ============================================================================
 * WHAT THIS PAGE DELIBERATELY DOES NOT COLLECT
 * ============================================================================
 *
 * Only fields the shipped profile actions can already write, which is the same
 * list `userProfileUpdateSchema` holds and therefore the same list the
 * column-level UPDATE grant in 20260809211100 allows. No new backend, no new
 * column, no new grant — the architecture amendment beside
 * `has_completed_signup` was explicit that the three designed screens "collect
 * nothing the shipped profile actions and photo uploader cannot already write",
 * and this keeps that true.
 *
 * The prototype's third screen, `isSignup` (name and email, before the handoff
 * to Kinde), is still not built and is still not honest to build — see
 * `sign-in/page.tsx`. Its one real consequence is handled here instead: the
 * name fields it would have collected are on the details step, because Kinde
 * does not always supply a name and a member with no name at all shows up to
 * the person they just met as an email address.
 */
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  let context;
  try {
    context = await getAuthenticatedContext();
  } catch (error) {
    // Same three named failures the gate and the sign-in screen handle, for the
    // same reason: a person holding a valid Kinde session that cannot become a
    // SmartCard session must get a screen, not Next's error page. Anything
    // unrecognised is re-thrown rather than dressed up as an account problem.
    const failure = classifyAuthFailure(error);
    if (failure === null) throw error;
    return <AuthFailureScreen failure={failure} />;
  }

  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;

  // Guards the other direction from the gate. Someone who has finished can
  // still type this URL, or land on it from a stale tab, and re-running setup on
  // a live profile would be a wizard offering to overwrite fields they have
  // since edited.
  if (await hasCompletedSignup(supabase, userId)) {
    redirect("/");
  }

  const profile = await getOwnProfile(supabase, userId);
  const photoUrl = await signedProfilePhotoUrl(supabase, profile.photo_path);

  return <OnboardingFlow profile={profile} photoUrl={photoUrl} />;
}
