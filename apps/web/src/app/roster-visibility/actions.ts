"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getAuthenticatedContext, type AuthenticatedContext } from "@/server/auth/current-user";
import { safeActionErrorMessage, UserFacingError } from "@/server/errors";
import { updateOwnProfile } from "@/server/profile/profile-service";

import type { ActionState } from "@/app/(app)/profile/action-state";

/**
 * The two ways off `/roster-visibility` — same shape as `onboarding/actions.ts`'s
 * pair, and for the same reason: the gate in `(app)/layout.tsx` is
 * unconditional, so both exits have to write `roster_visibility_chosen_at`
 * or the person is returned here forever with nothing they can do about it.
 *
 * SECURITY NOTE THIS FILE SHARES WITH EVERY OTHER `actions.ts` IN THIS APP
 *
 * A Server Action is a POST endpoint reachable by anyone who can send the
 * request, not only by someone who loaded this page. Both actions re-derive
 * the caller from a fresh `getAuthenticatedContext()` and write through that
 * context's own RLS-bound client — never a caller id trusted from anywhere
 * else.
 */

async function requireContext(): Promise<AuthenticatedContext> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    throw new UserFacingError("You need to be signed in to do that.");
  }
  return context;
}

/**
 * "Yes, show my card" / "No, keep me hidden" — writes the real choice.
 *
 * `visible` is a bound argument (`chooseRosterVisibilityAction.bind(null, true)`),
 * not a form field — the two buttons on this screen assert an outcome
 * directly, the same pattern `updateEmailOptInAction`/`updateRosterVisibilityAction`
 * use for their own toggle. The timestamp is read here, server-side, never
 * accepted from the client — see `updateRosterVisibilityAction`'s own header
 * for why that matters.
 */
export async function chooseRosterVisibilityAction(
  visible: boolean,
  _prevState: ActionState,
): Promise<ActionState> {
  const context = await requireContext();

  try {
    await updateOwnProfile(context.supabase, context.userId, {
      roster_visibility: visible ? "visible" : "hidden",
      roster_visibility_chosen_at: new Date().toISOString(),
    });
  } catch (error) {
    return { error: safeActionErrorMessage(error, "roster-visibility") };
  }

  finishAndGoHome();
}

/**
 * "Not now" — records that the prompt was answered without changing the
 * stored preference, which stays whatever it already was (null, i.e.
 * hidden, for everyone who reaches this screen — see this route's own
 * `page.tsx` for why that is always true here). Matches `skipOnboardingAction`'s
 * shape exactly: a one-button form with no fields, so a prefetch can never
 * trigger a write.
 */
export async function skipRosterVisibilityAction(): Promise<void> {
  const context = await requireContext();
  await updateOwnProfile(context.supabase, context.userId, {
    roster_visibility_chosen_at: new Date().toISOString(),
  });
  finishAndGoHome();
}

/**
 * Shared tail, matching `onboarding/actions.ts`'s own. `redirect()` signals
 * by throwing, so it runs last and outside any `try`.
 */
function finishAndGoHome(): never {
  revalidatePath("/");
  revalidatePath("/profile");
  redirect("/");
}
