import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Turns an `events.cover_image_path` into something a browser can load, and
 * knows the one path shape the bucket accepts.
 *
 * WHY THIS EXISTS AS ITS OWN MODULE
 *
 * `cover_image_path` is an object key inside the private `event-covers`
 * bucket, never a URL — the same arrangement `users.photo_path` has, and this
 * module is the events-side counterpart of
 * `apps/web/src/server/profile/photo-url.ts`. The bucket is private
 * (`public = false`) and its policies live in
 * `supabase/migrations/20260814051400_storage_event_covers_bucket_and_rls.sql`.
 *
 * THE ACCESS RULE HERE IS NOT THE ONE PROFILE PHOTOS USE, AND THE DIFFERENCE
 * MATTERS
 *
 * A profile photo is readable only by its owner's own `{user_id}/` prefix. An
 * event cover is readable by *anyone who can already see the event* — which is
 * every authenticated user for a public event, and only the host plus people
 * holding an RSVP row for a private one. That is deliberate: a cover exists to
 * be seen by the people looking at the event, and tying its visibility to the
 * event row's own visibility is what stops the two drifting apart later. It is
 * still not a public bucket: a private event's cover must not be fetchable by
 * somebody who cannot see the event at all, and no cover should be hotlinkable
 * by anyone holding a guessed or leaked path.
 *
 * WHY THE SIGNED URL IS SHORT-LIVED
 *
 * A signed URL is a bearer credential: whoever holds it can fetch the object
 * until it expires, with no further check. An hour is long enough to render a
 * page and navigate around it without reissuing mid-session, and short enough
 * that a URL leaked into browser history, a proxy log or a screenshot of page
 * source is worthless soon after. Same value and same reasoning as
 * `photo-url.ts` — deliberately not a different number, because two different
 * TTLs would imply a distinction that does not exist.
 *
 * WHY MINTING GOES THROUGH THE RLS-BOUND CLIENT, NOT THE SERVICE ROLE
 *
 * Supabase Storage enforces RLS at *signing* time, not only at fetch time, so
 * minting with the caller's own client means a request can only ever produce a
 * signed URL for an object it is actually allowed to read. The policy is
 * therefore the real gate. Using the service role here would silently bypass
 * the exact check this module exists to respect, which is why
 * `service-role-client.ts` stays off the request path everywhere except
 * `ensureUser()`.
 */

const BUCKET = "event-covers";

/** Seconds. See the header; matches `photo-url.ts` on purpose. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * The only file extensions the bucket's policies (and its `allowed_mime_types`)
 * accept. Exported so an upload UI can filter a file picker with the same list
 * the database will enforce, rather than a longer one that produces a confusing
 * rejection after the upload.
 */
export const EVENT_COVER_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

export type EventCoverExtension = (typeof EVENT_COVER_EXTENSIONS)[number];

/**
 * The object key for an event's cover: `{event_id}/cover.{ext}`, and nothing
 * else is a valid key in this bucket.
 *
 * The convention is not a naming preference, it is the access control. The
 * Storage policies parse the event id back out of this path and ask
 * `private.is_event_host` / `private.can_see_event` about it, and a key that
 * does not match the shape exactly resolves to a null event id, which fails
 * every check. Building the path here — rather than letting a caller assemble
 * one — is what keeps the app from producing keys the database will reject.
 *
 * Pinning the filename also means an event can hold at most one cover object,
 * so uploading a replacement overwrites rather than accumulating.
 */
export function eventCoverPath(eventId: string, extension: EventCoverExtension): string {
  return `${eventId}/cover.${extension}`;
}

/**
 * @param supabase RLS-bound client for the viewer — never the service role.
 * @param coverImagePath `events.cover_image_path`. `null` (no cover) returns
 *   `null` without a Storage call.
 * @returns A signed, time-limited URL, or `null` if there is no cover, or if
 *   signing failed — because the object is missing, or because the caller is
 *   not allowed to read it, which for a private event is the correct answer
 *   rather than an error. A failure here degrades to "no cover image", exactly
 *   as `signedProfilePhotoUrl` degrades to "no photo": it must never throw and
 *   take down a whole event page over a missing image.
 */
export async function signedEventCoverUrl(
  supabase: SupabaseClient,
  coverImagePath: string | null,
): Promise<string | null> {
  if (!coverImagePath) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(coverImagePath, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    return null;
  }
  return data.signedUrl;
}

/**
 * Uploads (or replaces) the cover for an event the caller hosts, and returns
 * the path to store in `events.cover_image_path`.
 *
 * `upsert: true` because the path is fixed per event: a host replacing their
 * cover is overwriting one object, not creating a second one. The write is
 * still gated by the bucket's INSERT/UPDATE policies, which require the caller
 * to be the event's host — this function does not check that itself, on
 * purpose, for the same reason nothing else in this codebase re-implements a
 * policy it can rely on. A non-host's upload fails at the database.
 */
export async function uploadEventCover(
  supabase: SupabaseClient,
  eventId: string,
  extension: EventCoverExtension,
  file: Blob,
): Promise<string> {
  const path = eventCoverPath(eventId, extension);

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type,
  });

  if (error) {
    throw new Error(`Failed to upload the event cover: ${error.message}`, { cause: error });
  }
  return path;
}
