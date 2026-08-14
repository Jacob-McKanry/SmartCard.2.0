/**
 * `public.events` — see 20260809210300_table_events_and_event_rsvps.sql and
 * 20260814051000_table_cities_and_event_capacity_columns.sql
 *
 * Event venue coordinates sit on the row itself, unlike meeting coordinates
 * which are quarantined in their own table. §2.6 draws the line: a public event
 * at a public venue is meant to be found and describes a building; a meeting
 * location describes where a specific identified person physically was.
 */
import { z } from "zod";

import { integerSchema, latitudeSchema, longitudeSchema, timestamptzSchema, uuidSchema } from "./scalars";
import { eventVisibilitySchema } from "./enums";

export const eventRowSchema = z.object({
  id: uuidSchema,
  host_user_id: uuidSchema,

  /** FK → `public.cities`. NOT NULL: browse is city-first. */
  city_id: uuidSchema,

  title: z.string(),
  description: z.string().nullable(),

  starts_at: timestamptzSchema,
  ends_at: timestamptzSchema.nullable(),

  /**
   * IANA zone name for the venue. `starts_at` already pins the instant; this is
   * what lets both apps render the venue's local time rather than the viewer's.
   */
  timezone: z.string().nullable(),

  venue_name: z.string().nullable(),
  venue_address: z.string().nullable(),

  latitude: latitudeSchema.nullable(),
  longitude: longitudeSchema.nullable(),

  visibility: eventVisibilitySchema,

  /**
   * Maximum `going` RSVPs, or `null` for unlimited. Only `going` consumes a
   * seat — `interested` never does. Enforced by the RSVP RPCs, not by a
   * constraint: a cap is a rule about a set of rows, which a per-row CHECK
   * cannot express.
   */
  capacity: integerSchema.nullable(),

  /**
   * Independent of `visibility`. `true` means a `going` request is stored as
   * `pending` until the host decides. All four combinations of the two flags
   * are real; neither is derived from the other.
   */
  requires_approval: z.boolean(),

  /**
   * Object path inside the private `event-covers` bucket, not a URL — the same
   * arrangement `users.photo_path` has. The convention is exactly
   * `{event_id}/cover.{jpg|jpeg|png|webp}`, enforced by the Storage policies in
   * 20260814051400, and rendering it requires a short-lived signed URL
   * (`apps/web/src/server/events/cover-url.ts`).
   */
  cover_image_path: z.string().nullable(),

  created_at: timestamptzSchema,
});

export type EventRow = z.infer<typeof eventRowSchema>;

/**
 * What a person may set when creating an event — mirrors the column-level
 * INSERT grant in 20260814051100 one-for-one, minus `host_user_id`.
 *
 * `host_user_id` is in that grant (the row has to name a host) but is
 * deliberately not collected here: the service layer fills it from the
 * authenticated caller's own id, never from client input, so a request cannot
 * create an event hosted by somebody else. The policy's `with check` would
 * refuse it anyway — this is the same rule enforced one layer earlier, the same
 * arrangement `socialLinkInsertSchema` describes for `user_id`.
 *
 * `id` and `created_at` are absent because they are not in the grant at all: a
 * client-chosen id could collide with something that already refers to it, and
 * a client-chosen `created_at` would let an event claim to be older than it is.
 */
export const eventInsertSchema = z.object({
  city_id: uuidSchema,
  title: z.string().trim().min(1, "Give your event a title.").max(200),
  description: z.string().trim().max(5000).nullable().default(null),

  starts_at: timestamptzSchema,
  ends_at: timestamptzSchema.nullable().default(null),

  timezone: z.string().trim().max(100).nullable().default(null),

  venue_name: z.string().trim().max(200).nullable().default(null),
  venue_address: z.string().trim().max(500).nullable().default(null),

  latitude: latitudeSchema.nullable().default(null),
  longitude: longitudeSchema.nullable().default(null),

  visibility: eventVisibilitySchema.default("private"),

  /**
   * `.positive()` mirrors the `check (capacity > 0)` constraint. A capacity of
   * zero is not an event with no seats, it is a typo — and catching it here
   * gives the person a sentence instead of a constraint violation.
   */
  capacity: integerSchema.positive("Capacity must be at least 1.").nullable().default(null),

  requires_approval: z.boolean().default(false),

  cover_image_path: z.string().nullable().default(null),
});

export type EventInsert = z.infer<typeof eventInsertSchema>;

/**
 * What a host may change about an event they already own — mirrors the combined
 * column-level UPDATE grants from 20260809211300 and 20260814051100.
 *
 * `host_user_id` is excluded from both grants and from this schema: an event
 * cannot be handed to somebody else after the fact. That asymmetry with
 * `eventInsertSchema` is deliberate and is the reason column-level grants exist
 * at all — RLS cannot say "this row but not that column".
 */
export const eventUpdateSchema = eventInsertSchema.partial();

export type EventUpdate = z.infer<typeof eventUpdateSchema>;
