import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { updateOwnEvent } from "./events-service";
import {
  eventCoverPath,
  uploadEventCover,
  type EventCoverExtension,
} from "./cover-url";

/**
 * Set / replace / remove the cover image of an event the caller hosts.
 *
 * `uploadEventCover` (in `cover-url.ts`) has existed since the Events backend
 * landed on 2026-08-14 and nothing ever called it, so `cover_image_path` was
 * `null` for every event and every card rendered §5's striped placeholder. This
 * module is the missing half: it pairs the Storage write with the row update
 * that points at it, and it is the events-side counterpart of
 * `apps/web/src/server/profile/photo-upload.ts`, deliberately following that
 * file's structure rather than inventing a second shape.
 *
 * ============================================================================
 * WHY A COVER IS SET AFTER CREATION AND NOT ON THE CREATE FORM
 * ============================================================================
 *
 * The object key is `{event_id}/cover.{ext}` and that convention IS the access
 * control — the Storage policies parse the event id back out of the path and ask
 * `private.is_event_host` about it (20260814051400). So a cover cannot exist
 * before its event does: there is no id to key it under, and no host for the
 * policy to check. The three ways round that were considered and rejected:
 *
 *   * Upload to a staging prefix and move it after creation. That needs a
 *     policy for the staging prefix, which means a policy granting a write to a
 *     path with no event behind it — exactly the "malformed key denies"
 *     property the migration is built on, given away for a dropzone.
 *   * Hold the bytes in the create action and upload after the insert. It works,
 *     and it makes creating an event a two-step operation that can half-fail:
 *     the event exists, the upload does not, and the form that could retry has
 *     already navigated away. It also means a failed image quietly changes what
 *     "Publish event" did.
 *   * Upload from the host's own event page, after it exists. One step, one
 *     failure mode, retryable in place, and the surface it belongs on is the one
 *     that already exists for host-only management.
 *
 * The third is what this module serves, from the dark host panel on
 * `/events/[eventId]` (see `host-tools.tsx` for why host-only controls live on
 * that ground). Creating an event and giving it a picture are separate acts, and
 * an event without a cover is a complete event — the placeholder is a design
 * decision, not a missing-data state.
 *
 * ============================================================================
 * WHAT ACTUALLY ENFORCES "ONLY THE HOST", AND WHAT DOES NOT
 * ============================================================================
 *
 * Not this file. The Storage policies in 20260814051400 do — verified against
 * the live database rather than read off the migration: `storage.objects` has
 * exactly four `event-covers` policies, all `to authenticated`, and INSERT,
 * UPDATE and DELETE each require
 * `private.is_event_host(auth.uid(), private.event_cover_event_id(name))`.
 * SELECT is `private.can_see_event(...)`, and `anon` is named by none of them.
 * The bucket is private, 5 MiB, `image/jpeg | image/png | image/webp`.
 *
 * On top of that, the `events` UPDATE policy independently refuses the row
 * update for anybody who is not the host (`updateOwnEvent` also filters on
 * `host_user_id`, belt and braces). So a non-host who skipped this module
 * entirely and called the Storage API directly would be refused the object, and
 * a non-host who somehow landed an object would still be refused the pointer.
 *
 * The checks in `assertUploadable` below are for a good error message, not for
 * safety — the same disclaimer `photo-upload.ts` opens with. The bucket's own
 * `allowed_mime_types` and `file_size_limit` are the enforcement, and they apply
 * to a caller who never runs this code.
 *
 * ============================================================================
 * WHY THE EXTENSION COMES FROM THE MEDIA TYPE AND NEVER FROM THE FILENAME
 * ============================================================================
 *
 * A key that does not match `{uuid}/cover.{jpg|jpeg|png|webp}` exactly parses to
 * a NULL event id, which fails every policy — so "my holiday photo.JPEG (2)"
 * would produce an upload refused by the database with nothing useful to say
 * about why. Deriving the extension from the browser-reported media type, out of
 * a fixed map, means this app can only ever ask for keys the policies accept.
 * It also means a renamed file cannot smuggle a different-looking key past the
 * pattern; the bucket's `allowed_mime_types` is what decides the bytes are
 * really an image of that type.
 */

const BUCKET = "event-covers";

/**
 * Media types the bucket accepts, mapped to the extension the path convention
 * accepts. Mirrors `allowed_mime_types` on the bucket and the regex in
 * `private.event_cover_event_id` at the same time — those two lists have to
 * agree, and this is the one place in the app that states the correspondence.
 *
 * `image/jpeg` maps to `jpg` rather than `jpeg`; both are legal in the pattern,
 * and pinning one keeps a single event from holding a `cover.jpg` *and* a
 * `cover.jpeg`, which is the one way the "at most one cover object per event"
 * property could be lost.
 */
const EXTENSION_BY_MIME_TYPE: Record<string, EventCoverExtension> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Mirrors `file_size_limit` on the bucket exactly: 5 * 1024 * 1024. */
const MAX_BYTES = 5 * 1024 * 1024;

export class InvalidCoverError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidCoverError";
  }
}

function extensionFor(file: File): EventCoverExtension {
  if (file.size === 0) {
    throw new InvalidCoverError("The selected file is empty.");
  }
  const extension = EXTENSION_BY_MIME_TYPE[file.type.toLowerCase()];
  if (extension === undefined) {
    throw new InvalidCoverError(
      `Covers must be JPEG, PNG or WEBP images (selected file is "${
        file.type || "an unrecognized type"
      }").`,
    );
  }
  if (file.size > MAX_BYTES) {
    throw new InvalidCoverError(
      `That file is too large — the limit is ${(MAX_BYTES / (1024 * 1024)).toFixed(0)}MB.`,
    );
  }
  return extension;
}

/**
 * Reads the caller's own event and returns its current cover path.
 *
 * Filtered by `host_user_id` as well as by `id`, so a non-host gets `null` and
 * this function refuses before a single byte is uploaded. That is not the
 * security boundary — Storage and the `events` UPDATE policy are, and both would
 * refuse independently — it is fail-closed ordering: an upload that is going to
 * be rejected at the pointer step should not have happened at all.
 */
async function currentCoverPath(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("events")
    .select("id, cover_image_path")
    .eq("id", eventId)
    .eq("host_user_id", userId)
    .maybeSingle<{ id: string; cover_image_path: string | null }>();

  if (error) {
    throw new Error(`Failed to read the event before changing its cover: ${error.message}`, {
      cause: error,
    });
  }
  if (data === null) {
    // Deliberately one message for "no such event" and "not your event",
    // matching `getEventForViewer`'s posture: distinguishing them would make
    // this a probe for whether a private event id is real.
    throw new Error("That event couldn't be updated — you may not be its host.");
  }
  return data.cover_image_path;
}

/**
 * Uploads a cover for an event the caller hosts and points
 * `events.cover_image_path` at it. Returns the stored path.
 *
 * ORDER, AND THE FAILURE MODE OF EACH STEP
 *
 * Check host → upload object → write pointer → delete the object it replaced.
 * The same ordering `replaceOwnProfilePhoto` uses and for the same reason: if a
 * step fails, the worst outcome is an orphaned object in Storage (cheap,
 * invisible, fixable), never a row pointing at nothing and never a host who
 * lost their old cover to a failed replacement.
 *
 * The one case that would leave an orphan is handled explicitly: if the *pointer*
 * write fails after a NEW object landed, the object is rolled back. Note the
 * "new" — the key depends only on the media type, so re-uploading the same
 * format overwrites in place and the pointer is already correct; there is
 * nothing to roll back, and rolling back would delete the host's live cover
 * over a failed no-op write. Changing format (`cover.png` → `cover.webp`) is
 * the case that produces a second object, and that is the case the rollback and
 * the cleanup below both key off.
 */
export async function replaceEventCover(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
  file: File,
): Promise<string> {
  const extension = extensionFor(file);
  const previousPath = await currentCoverPath(supabase, userId, eventId);
  const path = eventCoverPath(eventId, extension);

  await uploadEventCover(supabase, eventId, extension, file);

  try {
    await updateOwnEvent(supabase, userId, eventId, { cover_image_path: path });
  } catch (error) {
    if (path !== previousPath) {
      // Best effort. If this cleanup fails too, the error below is still what
      // the caller sees and acts on — an unreferenced object is not a fault the
      // host can do anything about.
      await supabase.storage.from(BUCKET).remove([path]);
    }
    throw error;
  }

  // Replace, don't accumulate. Only reachable when the format changed, since
  // otherwise the two paths are identical.
  if (previousPath !== null && previousPath !== path) {
    await supabase.storage.from(BUCKET).remove([previousPath]);
  }

  return path;
}

/**
 * Clears an event's cover: unsets the column, then removes the object.
 *
 * Pointer first, object second — the opposite order from upload, and for the
 * same reason. A row pointing at a deleted object renders a broken hero for
 * everybody who can see the event; an object nothing points at renders nothing
 * at all. If the delete fails after the column is cleared, the event correctly
 * shows the placeholder and a stray file survives in a private bucket that
 * nothing links to.
 */
export async function removeEventCover(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
): Promise<void> {
  const previousPath = await currentCoverPath(supabase, userId, eventId);
  if (previousPath === null) {
    return;
  }

  await updateOwnEvent(supabase, userId, eventId, { cover_image_path: null });

  await supabase.storage.from(BUCKET).remove([previousPath]);
}
