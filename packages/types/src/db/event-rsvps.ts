/**
 * `public.event_rsvps` — see 20260809210300_table_events_and_event_rsvps.sql
 *
 * One answer per person per event. Row access is narrow (your own plus your
 * connections'): the full attendee list is deliberately unreadable, and
 * "you know 4 people going" is computed by a security definer function rather
 * than answered with rows (§3.3).
 */
import { z } from "zod";

import { timestamptzSchema, uuidSchema } from "./scalars";
import { rsvpStatusSchema } from "./enums";

export const eventRsvpRowSchema = z.object({
  id: uuidSchema,
  event_id: uuidSchema,
  user_id: uuidSchema,
  status: rsvpStatusSchema,
  responded_at: timestamptzSchema,
});

export type EventRsvpRow = z.infer<typeof eventRsvpRowSchema>;
