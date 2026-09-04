import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  socialLinkInsertSchema,
  socialLinkUpdateSchema,
  userProfileUpdateSchema,
  type SocialLinkInsert,
  type SocialLinkRow,
  type SocialLinkUpdate,
  type UserProfileUpdate,
  type UserRow,
} from "@smartcard/types";

/**
 * The service layer for the Profile feature (architecture §1.7: "one API, one
 * service layer" — business logic lives here, not scattered across Server
 * Actions or components). Every function takes the caller's *own*
 * RLS-bound `SupabaseClient` (from `getAuthenticatedContext()`) and never the
 * service role — there is no reason a profile edit needs to bypass RLS, and
 * doing so would undermine the entire point of the auth bridge (§5.4).
 *
 * Every write additionally filters by the caller's own id/user_id even though
 * the RLS policies in `20260809211100_rls_policies_identity_and_cards.sql`
 * already restrict the affected rows to the caller's own — belt-and-braces
 * per the Next.js data-security guidance (`node_modules/next/dist/docs`):
 * a client legitimately names *which* row to act on, but ownership is always
 * re-derived from the authenticated session, never trusted from the request.
 * If the filter and the RLS policy ever disagree, the RLS policy is still the
 * real backstop — this is defense in depth, not the only lock.
 *
 * WHY THIS IS NOT IN `packages/core`
 *
 * §1.3 keeps `packages/core` free of network and database access so it stays
 * unit-testable without either. Every function below is a thin, direct
 * Supabase call with no logic worth sharing outside "how do you fetch or
 * write this row" — there is no platform-independent *rule* here the way
 * there is for GPS distance or connection verification. Mobile Profile is
 * explicitly out of scope for this pass (mobile Kinde auth isn't wired yet),
 * so there is also no second caller yet to share this with. If/when mobile
 * Profile is built, the natural home for this logic is a Route Handler that
 * both platforms' `packages/api-client` calls into (§1.7) — this module is
 * already shaped to move behind one with no change to its signatures, since
 * it takes a plain `SupabaseClient` rather than anything web-specific.
 */

/** Columns actually needed to render/edit a profile. Never `is_admin`, `status`, etc. */
const PROFILE_COLUMNS =
  "id, first_name, last_name, username, phone_number, bio, company_name, company_role, photo_path, email, email_opt_in, roster_visibility";

export type OwnProfile = Pick<
  UserRow,
  | "id"
  | "first_name"
  | "last_name"
  | "username"
  | "phone_number"
  | "bio"
  | "company_name"
  | "company_role"
  | "photo_path"
  | "email"
  | "email_opt_in"
  | "roster_visibility"
>;

/**
 * Fetches the signed-in caller's own profile row.
 *
 * Deliberately takes no `userId` parameter beyond what's needed for the
 * `.eq()` filter above — the row this returns is entirely a function of whose
 * RLS-bound client is passed in. There is no code path here (or anywhere in
 * this feature) that can be asked to fetch *someone else's* profile; that is
 * out of scope by design (see the "no viewer-facing profile route" note in
 * `apps/web/src/app/profile/page.tsx`), not merely unimplemented.
 */
export async function getOwnProfile(supabase: SupabaseClient, userId: string): Promise<OwnProfile> {
  const { data, error } = await supabase
    .from("users")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .single<OwnProfile>();

  if (error) {
    throw new Error(`Failed to load own profile: ${error.message}`, { cause: error });
  }
  return data;
}

/**
 * Validates and writes a profile edit.
 *
 * `updates` is parsed against `userProfileUpdateSchema` from
 * `packages/types` — the exact column list the UPDATE grant in
 * 20260809211100 allows a user to touch — so a bug that tried to pass, say,
 * `is_admin` through would fail here at validation, before it ever reached a
 * query, on top of the database refusing it either way.
 */
export async function updateOwnProfile(
  supabase: SupabaseClient,
  userId: string,
  updates: UserProfileUpdate,
): Promise<void> {
  const parsed = userProfileUpdateSchema.parse(updates);

  const { error } = await supabase.from("users").update(parsed).eq("id", userId);

  if (error) {
    throw new Error(`Failed to update profile: ${error.message}`, { cause: error });
  }
}

/**
 * Whether this account has ever answered the event-roster opt-in prompt —
 * `roster_visibility_chosen_at is not null`. Drives the one-time sign-in
 * gate in `(app)/layout.tsx` for accounts that predate the roster feature,
 * the same shape `hasCompletedSignup` uses for onboarding.
 *
 * Throws rather than defaulting, for the identical reason that function
 * gives: a `false` default on a transient read failure would loop someone
 * who already chose back into the prompt forever, and a `true` default
 * would silently skip asking someone who has never been asked. Read through
 * the caller's own RLS-bound client — `roster_visibility_chosen_at` is in
 * the same column-scoped SELECT grant as every other profile field, and the
 * gate that consumes this runs on every signed-in page, which is the wrong
 * place for an unpoliced read.
 */
export async function hasChosenRosterVisibility(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("users")
    .select("roster_visibility_chosen_at")
    .eq("id", userId)
    .single<{ roster_visibility_chosen_at: string | null }>();

  if (error) {
    throw new Error(`Failed to read the roster visibility choice: ${error.message}`, { cause: error });
  }
  return data.roster_visibility_chosen_at !== null;
}

export async function listOwnSocialLinks(
  supabase: SupabaseClient,
  userId: string,
): Promise<SocialLinkRow[]> {
  const { data, error } = await supabase
    .from("social_links")
    .select("id, user_id, platform, url, display_order, created_at, updated_at")
    .eq("user_id", userId)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load social links: ${error.message}`, { cause: error });
  }
  return data;
}

/**
 * Adds a link to the caller's own profile.
 *
 * `user_id` is set here, from the authenticated `userId`, never taken from
 * `input` — see the comment on `socialLinkInsertSchema` in
 * `packages/types/src/db/social-links.ts` for why that matters: a client
 * that could supply its own `user_id` could attach a link to someone else's
 * profile.
 */
export async function addOwnSocialLink(
  supabase: SupabaseClient,
  userId: string,
  input: SocialLinkInsert,
): Promise<SocialLinkRow> {
  const parsed = socialLinkInsertSchema.parse(input);

  const { data, error } = await supabase
    .from("social_links")
    .insert({ ...parsed, user_id: userId })
    .select("id, user_id, platform, url, display_order, created_at, updated_at")
    .single<SocialLinkRow>();

  if (error) {
    throw new Error(`Failed to add social link: ${error.message}`, { cause: error });
  }
  return data;
}

export async function updateOwnSocialLink(
  supabase: SupabaseClient,
  userId: string,
  linkId: string,
  updates: SocialLinkUpdate,
): Promise<void> {
  const parsed = socialLinkUpdateSchema.parse(updates);

  const { error } = await supabase
    .from("social_links")
    .update(parsed)
    .eq("id", linkId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update social link: ${error.message}`, { cause: error });
  }
}

export async function deleteOwnSocialLink(
  supabase: SupabaseClient,
  userId: string,
  linkId: string,
): Promise<void> {
  const { error } = await supabase
    .from("social_links")
    .delete()
    .eq("id", linkId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete social link: ${error.message}`, { cause: error });
  }
}
