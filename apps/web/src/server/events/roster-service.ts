import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { eventRosterSchema, eventAttendeeProfileSchema, type EventRosterEntry } from "@smartcard/types";
import type { VCardPhoto } from "@/server/cards/vcard";

/**
 * The service layer for the event attendee roster
 * (`docs/architecture/2026-08-27-event-attendee-roster.md`,
 * `supabase/migrations/20260904100000_event_attendee_roster.sql`). Two
 * functions, one per RPC — neither decides anything; `event_roster` and
 * `event_attendee_profile` re-derive the caller, the population, the opt-in
 * gate, the `starts_at`/cancelled gate and the rate limit themselves. This
 * file only calls them through the caller's own RLS-bound client and turns
 * the response into a typed value.
 *
 * WHY THE TWO FUNCTIONS BELOW TAKE OPPOSITE FAILURE POSTURES, LIKE
 * `attended-events-service.ts`'s OWN PAIR DOES FOR THE IDENTICAL REASON
 *
 * `listEventRoster` fails closed to `[]` on any error — a transport failure,
 * a malformed response, a thrown exception. That is the right direction here
 * because `event_roster` already collapses every refusal reason (not an
 * attendee, event not started, cancelled) to an empty set (§3.2/§7 of the
 * design), so a failed READ producing the same empty list does not disclose
 * or hide anything a working read could not also legitimately answer.
 *
 * `getAttendeeProfile` throws on a transport or shape failure and returns
 * `null` only for the RPC's own `{available:false}` answer. Opening one
 * person's card is not a decorative list — a caller (the roster's profile
 * sheet) needs to tell "the network broke, try again" apart from "you can't
 * see this person", the same distinction `claimEventImport` draws for the
 * identical reason.
 */

export async function listEventRoster(
  supabase: SupabaseClient,
  eventId: string,
): Promise<EventRosterEntry[]> {
  try {
    const { data, error } = await supabase.rpc("event_roster", { p_event_id: eventId });

    if (error) {
      console.error("[events/roster] event_roster failed", {
        error: error.message,
        cause: JSON.stringify(error),
      });
      return [];
    }

    const parsed = eventRosterSchema.safeParse(data);
    if (!parsed.success) {
      console.error("[events/roster] event_roster returned an unexpected shape", {
        error: parsed.error.message,
      });
      return [];
    }

    return parsed.data;
  } catch (error) {
    console.error("[events/roster] event_roster threw", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** The card-preview-depth fields `event_attendee_profile` returns on success — see that RPC's header. */
export interface AttendeeProfile {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  companyRole: string | null;
  bio: string | null;
  phoneNumber: string | null;
  email: string;
  photoPath: string | null;
  socialLinks: readonly { id: string; platform: string; url: string }[];
}

/**
 * Opens one opted-in co-attendee's profile, or `null` if the RPC refused —
 * indistinguishably, for any of the reasons in its own header (not an
 * attendee, subject not opted in, event not started or cancelled, over
 * budget). `forSave` must be `true` for the call immediately before building
 * a vCard, so the SAVES budget and log entry are the ones consumed — see
 * `event_attendee_profile`'s own comment on why this is one RPC, not two.
 */
export async function getAttendeeProfile(
  supabase: SupabaseClient,
  eventId: string,
  subjectUserId: string,
  forSave = false,
): Promise<AttendeeProfile | null> {
  const { data, error } = await supabase.rpc("event_attendee_profile", {
    p_event_id: eventId,
    p_subject_user_id: subjectUserId,
    p_for_save: forSave,
  });

  if (error) {
    throw new Error(`Failed to load this person's profile: ${error.message}`, { cause: error });
  }

  const parsed = eventAttendeeProfileSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("event_attendee_profile returned an unexpected shape", { cause: parsed.error });
  }

  if (!parsed.data.available) {
    return null;
  }

  return {
    firstName: parsed.data.first_name,
    lastName: parsed.data.last_name,
    companyName: parsed.data.company_name,
    companyRole: parsed.data.company_role,
    bio: parsed.data.bio,
    phoneNumber: parsed.data.phone_number,
    email: parsed.data.email,
    photoPath: parsed.data.photo_path,
    socialLinks: parsed.data.social_links,
  };
}

/**
 * Media types the roster's vCard will embed, and the vCard 3.0 `TYPE=` token
 * for each — the identical allowlist `card-preview-service.ts`'s
 * `EMBEDDABLE_PHOTO_TYPES` uses, duplicated rather than imported because that
 * module's copy is a private implementation detail of an unrelated,
 * unauthenticated flow (see below) and not exported. Anything not on this
 * list omits `PHOTO` rather than trusting an unrecognised type token into a
 * vCard property parameter.
 */
const EMBEDDABLE_PHOTO_TYPES: Record<string, string> = {
  "image/webp": "WEBP",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/gif": "GIF",
};

/** Matches the `profile-photos` bucket's own 5 MiB `file_size_limit` — see `card-preview-service.ts` for the fuller history of this number. */
const MAX_EMBEDDED_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * The bytes behind a roster subject's `photo_path`, for the vCard's `PHOTO`
 * property — the roster's counterpart to `card-preview-service.ts`'s
 * `loadPhotoBytes`, with one deliberate difference: THIS DOWNLOADS THROUGH
 * THE CALLER'S OWN RLS-BOUND CLIENT, NOT THE SERVICE ROLE.
 *
 * `loadPhotoBytes` uses the service role because its flow (`/card/[code]`)
 * is unauthenticated — there is no caller identity to bind a client to. The
 * roster is the opposite: every read here already has a signed-in viewer,
 * and the whole service layer's own design (see this file's header) is that
 * nothing in this feature reaches for elevated access when the caller's own
 * RLS-bound client can answer. It can, for exactly this read, because of
 * `supabase/migrations/20260904110000_storage_profile_photos_follow_roster_membership.sql`
 * — the `profile-photos` storage SELECT policy was widened specifically so
 * a roster viewer's own client can read a co-attendee's photo object,
 * closing a gap that migration's header documents in full (a host or a
 * claimed-only attendee, both without RSVP rows, could not read a
 * co-attendee's photo through the pre-existing policy even though
 * `event_attendee_profile` already told them the path).
 *
 * Fails to `null`, never throws: no photo, a deleted object, an
 * unembeddable media type, an oversized file, or — correctly — the caller
 * not being allowed to read that path all produce the same "no PHOTO
 * property", and the vCard is still valid without one.
 */
export async function loadAttendeePhotoForVCard(
  supabase: SupabaseClient,
  photoPath: string | null,
): Promise<VCardPhoto | null> {
  if (!photoPath) return null;

  const { data, error } = await supabase.storage.from("profile-photos").download(photoPath);
  if (error || !data) return null;

  const vCardType = EMBEDDABLE_PHOTO_TYPES[data.type.toLowerCase()];
  if (vCardType === undefined) return null;

  if (data.size > MAX_EMBEDDED_PHOTO_BYTES) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.byteLength > MAX_EMBEDDED_PHOTO_BYTES) return null;

  return { vCardType, base64: bytes.toString("base64") };
}
