/**
 * The event attendee roster — `docs/architecture/2026-08-27-event-attendee-roster.md`,
 * built by `supabase/migrations/20260904100000_event_attendee_roster.sql`.
 *
 * `public.event_roster_views` — like `event_attendee_imports`, this table's
 * RLS is enabled and forced with zero policies and zero grants (§3.5: no app
 * code path, including the RPCs below, ever SELECTs from it, only INSERTs
 * into it). `eventRosterViewRowSchema` describes the shape for the same
 * documentary reason `event-attendee-imports.ts`'s own row schema does, not
 * because anything in this app can read one.
 *
 * The two schemas that are actually load-bearing are `event_roster`'s row
 * shape and `event_attendee_profile`'s result, at the bottom.
 */
import { z } from "zod";

import { timestamptzSchema, uuidSchema } from "./scalars";

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export const eventRosterViewRowSchema = z.object({
  id: uuidSchema,
  viewer_user_id: uuidSchema,
  subject_user_id: uuidSchema,
  event_id: uuidSchema,
  viewed_at: timestamptzSchema,
  contact_saved: z.boolean(),
});

export type EventRosterViewRow = z.infer<typeof eventRosterViewRowSchema>;

// ---------------------------------------------------------------------------
// public.event_roster(p_event_id) — the listing RPC
// ---------------------------------------------------------------------------

/**
 * One row of `event_roster`'s result: an opted-in co-attendee, name and photo
 * only. The full card-preview-depth read is a separate, rate-limited call
 * (`event_attendee_profile`) per person tapped — this list is deliberately
 * thin.
 */
export const eventRosterEntrySchema = z.object({
  user_id: uuidSchema,
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  photo_path: z.string().nullable(),
});

export type EventRosterEntry = z.infer<typeof eventRosterEntrySchema>;

export const eventRosterSchema = z.array(eventRosterEntrySchema);

// ---------------------------------------------------------------------------
// public.event_attendee_profile(p_event_id, p_subject_user_id, p_for_save)
// ---------------------------------------------------------------------------

/**
 * One social link on the roster profile — the same shape
 * `card-preview-service.ts`'s `PreviewSocialLink` already uses, restated here
 * so this package does not depend on an `apps/web`-local type.
 */
export const eventAttendeeProfileSocialLinkSchema = z.object({
  id: uuidSchema,
  platform: z.string(),
  url: z.string(),
});

/**
 * `{available: false}` and nothing else on any refusal — not an attendee, the
 * subject is not an attendee, the subject has not opted in, the event has not
 * started or is cancelled, or the caller is over budget. §3.6: these must stay
 * indistinguishable, so this is a discriminated union of exactly two shapes
 * rather than an `available: boolean` beside a bag of nullable fields, which
 * would let a caller peek at which fields are present/absent on a refusal.
 */
export const eventAttendeeProfileSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(false) }),
  z.object({
    available: z.literal(true),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    company_name: z.string().nullable(),
    company_role: z.string().nullable(),
    bio: z.string().nullable(),
    phone_number: z.string().nullable(),
    email: z.string(),
    photo_path: z.string().nullable(),
    social_links: z.array(eventAttendeeProfileSocialLinkSchema),
  }),
]);

export type EventAttendeeProfile = z.infer<typeof eventAttendeeProfileSchema>;
