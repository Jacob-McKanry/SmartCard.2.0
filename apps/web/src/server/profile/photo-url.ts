import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Turns a `users.photo_path` into something a browser can actually load.
 *
 * WHY THIS EXISTS AS ITS OWN MODULE
 *
 * `photo_path` is an object key inside the private `profile-photos` bucket,
 * never a URL (§6.5, `packages/types/src/db/users.ts`). The bucket is private
 * and has no anonymous read policy — see
 * `supabase/migrations/20260813191041_storage_rls_profile_photos.sql` — on
 * purpose: photos are profile data, and profile data is graph-gated (§3.4).
 * A public bucket or a raw Storage URL handed to the client would let anyone
 * who obtained or guessed the path fetch the bytes with no session and no
 * check at all, which is exactly the "no public profile URL" rule
 * CLAUDE.md's non-negotiable product rule exists to prevent. This function is
 * the *only* sanctioned way a photo path becomes something renderable —
 * every place in the app that shows a photo should call this rather than
 * building a Storage URL by hand.
 *
 * WHY THE SIGNED URL IS SHORT-LIVED
 *
 * A signed URL is a bearer credential: whoever holds it can fetch the object
 * until it expires, no further auth check performed. Minting a long-lived one
 * would mean a URL that leaked once (browser history, a proxy log, a shared
 * screenshot of page source) stays valid for a long time. An hour is enough
 * to render a page and follow ordinary navigation without needing to reissue
 * mid-session, and short enough that a leaked URL is worthless soon after.
 *
 * WHY MINTING GOES THROUGH THE RLS-BOUND CLIENT, NOT THE SERVICE ROLE
 *
 * `createSignedUrl` itself is subject to the SELECT policy on
 * `storage.objects` (Supabase Storage enforces RLS at signing time, not only
 * at fetch time), so calling it with the caller's own RLS-bound client means
 * a request can only ever mint a signed URL for a path it is actually allowed
 * to read — today, only its own `{user_id}/...` prefix. Using the service
 * role here would silently reopen the exact gate this function exists to
 * keep shut, for the same reason `service-role-client.ts` gives for staying
 * off the request path everywhere except `ensureUser()`.
 */

/** Seconds. Long enough to render and navigate a page; see the header above. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * @param supabase RLS-bound client for the viewer — never the service role.
 * @param photoPath `users.photo_path` for the profile being rendered. `null`
 *   (no photo set) returns `null` without a Storage call.
 * @returns A signed, time-limited URL, or `null` if there is no photo, or if
 *   signing failed (path not found in Storage, or — correctly — the caller is
 *   not allowed to read that path). A failure here degrades to "no photo
 *   shown", the same as `photoPath` being null; it must never throw and take
 *   down the whole profile render over a missing or foreign avatar.
 */
export async function signedProfilePhotoUrl(
  supabase: SupabaseClient,
  photoPath: string | null,
): Promise<string | null> {
  if (!photoPath) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from("profile-photos")
    .createSignedUrl(photoPath, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    return null;
  }
  return data.signedUrl;
}
