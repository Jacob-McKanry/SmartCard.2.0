import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { UserFacingError } from "@/server/errors";

/**
 * Upload/replace/remove for a user's own profile photo.
 *
 * WHAT ACTUALLY ENFORCES SAFETY HERE, AND WHAT DOESN'T
 *
 * The checks in `assertUploadable()` below are for a good error message, not
 * the security boundary — per the brief, "the real enforcement is the
 * bucket's own `allowed_mime_types`/`file_size_limit` plus [the] RLS policy;
 * don't trust the client." Concretely:
 *
 *  - The bucket (`20260813180355_create_profile_photos_bucket.sql`) rejects
 *    anything that isn't `image/webp` or over 5MB at the Storage API level,
 *    regardless of what this file checks first.
 *  - `storage.objects` RLS
 *    (`20260813191041_storage_rls_profile_photos.sql`) rejects any write
 *    whose path is not under this caller's own `{user_id}/` prefix,
 *    regardless of what path this file asks for.
 *
 * A malicious client that skips this module entirely and calls the Storage
 * API directly with a forged path or a spoofed content-type hits those same
 * two backstops. This module's checks exist so a legitimate user seeing an
 * oversized or wrong-type file gets a clear message instead of a raw Storage
 * API error.
 *
 * WHY UPLOAD GOES THROUGH THE RLS-BOUND CLIENT, NOT THE SERVICE ROLE
 *
 * Same reasoning as everywhere else in this feature (see
 * `profile-service.ts`): there is no reason a profile-photo write needs to
 * bypass RLS, and every caller of this module already has an RLS-bound
 * client from `getAuthenticatedContext()`. Using it here means the
 * `{user_id}/` prefix check in the migration is the thing actually stopping
 * a cross-user write — this code choosing the right path is a courtesy, not
 * the guarantee.
 */

const BUCKET = "profile-photos";

/** Mirrors `allowed_mime_types` on the bucket exactly (single value today). */
const ALLOWED_MIME_TYPE = "image/webp";

/** Mirrors `file_size_limit` on the bucket exactly: 5 * 1024 * 1024. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Extends `UserFacingError` because every message it carries was written for
 * the person who picked the file ("Photos must be WEBP images...", "That file
 * is too large..."), so it is safe — and useful — to show unchanged. That makes
 * the explicit `instanceof InvalidPhotoError` branch in `uploadPhotoAction`
 * redundant for the message's sake; it is kept there because the action still
 * distinguishes this case from a genuine failure.
 */
export class InvalidPhotoError extends UserFacingError {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidPhotoError";
  }
}

function assertUploadable(file: File): void {
  if (file.size === 0) {
    throw new InvalidPhotoError("The selected file is empty.");
  }
  if (file.type !== ALLOWED_MIME_TYPE) {
    throw new InvalidPhotoError(
      `Photos must be WEBP images (selected file is "${file.type || "an unrecognized type"}"). ` +
        'Most photo editors and "export as" dialogs can save a WEBP copy.',
    );
  }
  if (file.size > MAX_BYTES) {
    const maxMb = (MAX_BYTES / (1024 * 1024)).toFixed(0);
    throw new InvalidPhotoError(`That file is too large — the limit is ${maxMb}MB.`);
  }
}

/**
 * Uploads a new photo under the caller's own path prefix, points
 * `users.photo_path` at it, and cleans up whatever object it replaces.
 *
 * The three steps are deliberately ordered upload -> point -> clean up old,
 * not delete-old -> upload -> point: if anything fails partway, the failure
 * mode is "an extra orphaned object" (annoying, cheap, fixable later), never
 * "the user's profile_path points at nothing" or "the user's old photo is
 * gone and the new one never landed" (both fail the user visibly). The one
 * exception is handled explicitly below: if the *pointer* update itself
 * fails after the upload succeeded, the newly uploaded object is rolled back
 * so it doesn't sit in Storage unreferenced by anything.
 *
 * @returns The new `photo_path` to store — the caller (the Server Action)
 *   still owns actually writing it to `users.photo_path` for its own
 *   `useActionState` return-value bookkeeping, but this function has already
 *   done so by the time it returns; see the inline note below.
 */
export async function replaceOwnProfilePhoto(
  supabase: SupabaseClient,
  userId: string,
  file: File,
): Promise<string> {
  assertUploadable(file);

  const { data: current, error: readError } = await supabase
    .from("users")
    .select("photo_path")
    .eq("id", userId)
    .single<{ photo_path: string | null }>();

  if (readError) {
    throw new Error(`Failed to read current photo before upload: ${readError.message}`, {
      cause: readError,
    });
  }
  const previousPath = current.photo_path;

  // A fresh, unguessable filename per upload — never reuse a name, even on
  // replace. Reusing the previous object's name would mean briefly having no
  // valid object at that path while the new bytes upload (or, with `upsert`,
  // a caching CDN/browser serving stale bytes at an unchanged URL); a new
  // name sidesteps both.
  const newPath = `${userId}/${randomUUID()}.webp`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(newPath, file, {
    contentType: ALLOWED_MIME_TYPE,
    upsert: false,
  });
  if (uploadError) {
    throw new Error(`Failed to upload photo: ${uploadError.message}`, { cause: uploadError });
  }

  const { error: updateError } = await supabase
    .from("users")
    .update({ photo_path: newPath })
    .eq("id", userId);

  if (updateError) {
    // The pointer update failed after the object landed — roll the object
    // back rather than leave an orphan nothing in the database references.
    // Best-effort: if this cleanup itself fails, the update error below is
    // still the one the caller sees and acts on.
    await supabase.storage.from(BUCKET).remove([newPath]);
    throw new Error(`Failed to save the new photo path: ${updateError.message}`, {
      cause: updateError,
    });
  }

  // Replace, not accumulate: don't leave the old object orphaned in Storage
  // forever (see the build brief). Best-effort and non-fatal — the user's
  // new photo is already uploaded and recorded either way, so a failure here
  // should not surface as "your upload failed."
  if (previousPath && previousPath !== newPath) {
    await supabase.storage.from(BUCKET).remove([previousPath]);
  }

  return newPath;
}

/**
 * Clears the caller's photo entirely: unsets `users.photo_path` and removes
 * the underlying object. Not asked for explicitly, but a natural companion
 * to "edit every column the grant allows" — `photo_path` is nullable and
 * in the grant, and a user who wants to go back to having no photo needs a
 * way to do that which isn't "upload something you don't want as a
 * placeholder."
 */
export async function removeOwnProfilePhoto(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: current, error: readError } = await supabase
    .from("users")
    .select("photo_path")
    .eq("id", userId)
    .single<{ photo_path: string | null }>();

  if (readError) {
    throw new Error(`Failed to read current photo before removal: ${readError.message}`, {
      cause: readError,
    });
  }
  if (current.photo_path === null) {
    return;
  }

  const { error: updateError } = await supabase
    .from("users")
    .update({ photo_path: null })
    .eq("id", userId);

  if (updateError) {
    throw new Error(`Failed to clear photo path: ${updateError.message}`, { cause: updateError });
  }

  await supabase.storage.from(BUCKET).remove([current.photo_path]);
}
