"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { userProfileUpdateSchema } from "@smartcard/types";

import { getAuthenticatedContext, type AuthenticatedContext } from "@/server/auth/current-user";
import { updateOwnProfile } from "@/server/profile/profile-service";
import { assertSignupCompleted } from "@/server/onboarding/onboarding-service";

import type { ActionState } from "@/app/(app)/profile/action-state";

/**
 * The two ways out of onboarding. Both end with the same server-side assertion
 * that the flow is finished, and both then land on Home.
 *
 * SECURITY NOTE, THE SAME ONE `(app)/profile/actions.ts` CARRIES
 *
 * A Server Action is a POST endpoint reachable by anyone who can send the
 * request, whether or not they went through this UI. So neither action below
 * trusts anything about the page that invoked it: the caller's identity is
 * re-derived from a fresh `getAuthenticatedContext()`, and it fails closed —
 * no session is an error, never a silent no-op.
 *
 * The profile write goes through the caller's own RLS-bound client and the same
 * `updateOwnProfile` the Edit profile screen uses, so it is backstopped by the
 * `users` update policy and by the column-level grant exactly as an ordinary
 * edit is. Only the completion flag is written with the service role, because
 * that column is deliberately outside the client's reach — the reasoning is at
 * `assertSignupCompleted`.
 *
 * ORDER MATTERS AND IT IS THIS ONE: profile first, flag second. If the profile
 * write fails, the flag is never set and the person stays in the flow with
 * their answer still on screen and an error to read. The reverse order would
 * mark them finished and then lose what they typed, with the gate now refusing
 * to bring them back to the form that had it. There is no transaction spanning
 * the two and there does not need to be one: the failure mode of the order used
 * here is "try again", and the failure mode of the other order is "your details
 * are gone and you cannot get back".
 */

async function requireContext(): Promise<AuthenticatedContext> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    throw new Error("You need to be signed in to do that.");
  }
  return context;
}

/** `null` for a blank field rather than `""`, matching the nullable columns. */
function textOrNull(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * "Done" — save what they filled in, then record that setup is over.
 *
 * Every field is optional, so an empty form is a valid submission and is
 * treated as one: it writes nulls over nulls and finishes. That is not the same
 * as "Skip for now" only in the sense that the person looked at the form; the
 * outcome is identical, and pretending otherwise would mean inventing a
 * required field.
 *
 * The field list is a subset of `userProfileUpdateSchema`, which is itself the
 * column-level UPDATE grant. `username` is absent because there is no global
 * search or profile URL for one to matter on yet (Q3 is open) and asking a new
 * member to choose a handle whose only effect is a label is a question with no
 * good answer. It stays available on Edit profile.
 */
export async function completeOnboardingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireContext();

  const parsed = userProfileUpdateSchema.safeParse({
    first_name: textOrNull(formData, "first_name"),
    last_name: textOrNull(formData, "last_name"),
    phone_number: textOrNull(formData, "phone_number"),
    bio: textOrNull(formData, "bio"),
    company_name: textOrNull(formData, "company_name"),
    company_role: textOrNull(formData, "company_role"),
    email_opt_in: formData.get("email_opt_in") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "That value isn't valid." };
  }

  try {
    await updateOwnProfile(context.supabase, context.userId, parsed.data);
    await assertSignupCompleted(context.userId);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Something went wrong. Please try again.",
    };
  }

  finishAndGoHome();
}

/**
 * "Skip for now" — record that setup is over without writing anything else.
 *
 * This is the escape hatch the unconditional gate makes mandatory. It is a
 * `<form action={...}>` with no fields rather than a link, because it performs a
 * write; a link that quietly changed server state on GET would be the kind of
 * thing a prefetch could trigger by itself.
 */
export async function skipOnboardingAction(): Promise<void> {
  const context = await requireContext();
  await assertSignupCompleted(context.userId);
  finishAndGoHome();
}

/**
 * Shared tail. `redirect()` signals by throwing, so it is called last and never
 * inside a `try` — a `catch` around it would swallow the redirect and leave the
 * person on a finished form.
 *
 * Both screens the flag changes the behaviour of are revalidated: Home, which
 * the person is about to see, and Profile, whose photo/details may have just
 * been written.
 */
function finishAndGoHome(): never {
  revalidatePath("/");
  revalidatePath("/profile");
  redirect("/");
}
