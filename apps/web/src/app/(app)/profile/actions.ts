"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import {
  socialLinkInsertSchema,
  socialLinkUpdateSchema,
  userProfileUpdateSchema,
} from "@smartcard/types";

import { getAuthenticatedContext, type AuthenticatedContext } from "@/server/auth/current-user";
import type { ActionState } from "./action-state";
import {
  addOwnSocialLink,
  deleteOwnSocialLink,
  updateOwnProfile,
  updateOwnSocialLink,
} from "@/server/profile/profile-service";
import {
  InvalidPhotoError,
  removeOwnProfilePhoto,
  replaceOwnProfilePhoto,
} from "@/server/profile/photo-upload";

/**
 * Server Actions for the Profile feature.
 *
 * SECURITY NOTE THAT APPLIES TO EVERY EXPORT IN THIS FILE
 *
 * A Server Action is a POST endpoint reachable by anyone who can send the
 * same request, whether or not they went through `/profile`'s UI
 * (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`,
 * "Security"). Rendering the form only on an authenticated page is not a
 * security boundary, so every action here re-derives the caller's identity
 * from a fresh `getAuthenticatedContext()` call rather than trusting
 * anything about the page that (supposedly) invoked it — `requireContext()`
 * below is that check, and it fails closed: no session means an error, never
 * a silent no-op or a fallback identity.
 *
 * Every mutation also goes through the RLS-bound client from that context,
 * never the service role, so even a bug in this file's own logic is still
 * backstopped by the database policies in
 * `supabase/migrations/20260809211100_rls_policies_identity_and_cards.sql`.
 *
 * Every action ends by calling `revalidateProfileScreens()` so the same
 * response that carries the mutation's result also carries the pages' fresh
 * server-rendered state (see the Server Actions doc's "single response
 * carries data and UI") — the client never needs a follow-up fetch to see
 * its own edit take effect.
 */

/**
 * Both screens a profile edit changes, revalidated together.
 *
 * These actions are submitted from `/profile/edit`, and the result has to land
 * in two places: the form the person is looking at, and the `/profile` view
 * they came from and will go back to. Until the edit route existed there was
 * one page and one `revalidatePath("/profile")` call; left as it was, that
 * would now leave the edit page serving whatever it last rendered — a saved
 * change appearing on the profile but not in the form that saved it.
 *
 * Two literal paths rather than `revalidatePath("/profile", "layout")`: the
 * `layout` form invalidates everything sharing the layout file at that segment,
 * and `/profile` has no layout of its own, so it would resolve to the shared
 * `(app)` layout and purge every signed-in screen in the group. Naming the two
 * paths says exactly what changed and touches nothing else.
 *
 * `/onboarding` is the third, added with the onboarding flow. It reuses
 * `PhotoUploader` verbatim, so an upload there runs `uploadPhotoAction` here —
 * and without this line the step would keep rendering the `photoUrl` the page
 * was built with, i.e. the person uploads a picture and the avatar does not
 * change. Naming it here rather than special-casing it in the flow keeps the
 * "the action that writes a screen's data revalidates that screen" rule in one
 * place.
 */
function revalidateProfileScreens(): void {
  revalidatePath("/profile");
  revalidatePath("/profile/edit");
  revalidatePath("/onboarding");
}

async function requireContext(): Promise<AuthenticatedContext> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    // Matches the rest of this codebase's fail-closed posture (CLAUDE.md):
    // an action invoked with no valid session is refused outright, not
    // treated as a guest request for nothing in particular.
    throw new Error("You need to be signed in to do that.");
  }
  return context;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function firstIssue(error: ZodError): string {
  return error.issues[0]?.message ?? "That value isn't valid.";
}

/** `null` for a blank field rather than `""`, matching the nullable columns. */
function textOrNull(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// -----------------------------------------------------------------------
// Profile identity fields
// -----------------------------------------------------------------------

export async function updateProfileAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireContext();

  const parsed = userProfileUpdateSchema.safeParse({
    first_name: textOrNull(formData, "first_name"),
    last_name: textOrNull(formData, "last_name"),
    username: textOrNull(formData, "username"),
    phone_number: textOrNull(formData, "phone_number"),
    bio: textOrNull(formData, "bio"),
    company_name: textOrNull(formData, "company_name"),
    company_role: textOrNull(formData, "company_role"),
    email_opt_in: formData.get("email_opt_in") === "on",
  });

  if (!parsed.success) {
    return { error: firstIssue(parsed.error) };
  }

  try {
    await updateOwnProfile(context.supabase, context.userId, parsed.data);
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidateProfileScreens();
  return { success: true };
}

// -----------------------------------------------------------------------
// Social links
// -----------------------------------------------------------------------

export async function addSocialLinkAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireContext();

  const parsed = socialLinkInsertSchema.safeParse({
    platform: formData.get("platform"),
    url: formData.get("url"),
    display_order: 0,
  });

  if (!parsed.success) {
    return { error: firstIssue(parsed.error) };
  }

  try {
    await addOwnSocialLink(context.supabase, context.userId, parsed.data);
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidateProfileScreens();
  return { success: true };
}

/**
 * Bound to a specific link's id per row: `updateSocialLinkAction.bind(null, link.id)`
 * (the pattern the forms guide recommends for "which row" arguments outside
 * the form's own fields). `linkId` therefore comes from server-rendered
 * markup this action itself produced on the previous render, not from
 * anything the current request's form fields assert — but ownership is still
 * re-checked by `updateOwnSocialLink`'s `user_id` filter and by RLS, exactly
 * as if it hadn't been.
 */
export async function updateSocialLinkAction(
  linkId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireContext();

  const parsed = socialLinkUpdateSchema.safeParse({
    platform: formData.get("platform"),
    url: formData.get("url"),
  });

  if (!parsed.success) {
    return { error: firstIssue(parsed.error) };
  }

  try {
    await updateOwnSocialLink(context.supabase, context.userId, linkId, parsed.data);
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidateProfileScreens();
  return { success: true };
}

/**
 * No form fields of its own — bound the same way as `updateSocialLinkAction`
 * and invoked directly from a one-button form. `deleteOwnSocialLink` still
 * filters by `user_id`, and the RLS `delete` policy on `social_links`
 * (20260809211100) still backstops it either way.
 */
export async function deleteSocialLinkAction(linkId: string): Promise<void> {
  const context = await requireContext();
  await deleteOwnSocialLink(context.supabase, context.userId, linkId);
  revalidateProfileScreens();
}

// -----------------------------------------------------------------------
// Photo
// -----------------------------------------------------------------------

export async function uploadPhotoAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const context = await requireContext();

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a photo to upload." };
  }

  try {
    await replaceOwnProfilePhoto(context.supabase, context.userId, file);
  } catch (error) {
    if (error instanceof InvalidPhotoError) {
      return { error: error.message };
    }
    return { error: messageOf(error) };
  }

  revalidateProfileScreens();
  return { success: true };
}

export async function removePhotoAction(): Promise<void> {
  const context = await requireContext();
  await removeOwnProfilePhoto(context.supabase, context.userId);
  revalidateProfileScreens();
}
