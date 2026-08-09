/**
 * `public.events` — see 20260809210300_table_events_and_event_rsvps.sql
 *
 * Event venue coordinates sit on the row itself, unlike meeting coordinates
 * which are quarantined in their own table. §2.6 draws the line: a public event
 * at a public venue is meant to be found and describes a building; a meeting
 * location describes where a specific identified person physically was.
 */
import { z } from "zod";

import { latitudeSchema, longitudeSchema, timestamptzSchema, uuidSchema } from "./scalars";
import { eventVisibilitySchema } from "./enums";

export const eventRowSchema = z.object({
  id: uuidSchema,
  host_user_id: uuidSchema,

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

  cover_image_path: z.string().nullable(),

  created_at: timestamptzSchema,
});

export type EventRow = z.infer<typeof eventRowSchema>;
