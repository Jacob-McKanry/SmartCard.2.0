/**
 * `public.meeting_locations` — see 20260809210500_table_meetings.sql
 *
 * The most sensitive table in the schema: every column says where a specific,
 * identified person physically was at a known time. It exists as a separate
 * table precisely because RLS filters rows, not columns — keeping coordinates
 * off `meetings` means a mistake loses location data instead of leaking it.
 *
 * Read access is the §3.2 policy (participants always; mutuals of both parties
 * only with unanimous consent). There is no insert, update or delete policy at
 * all: rows are written by the verification service alone.
 *
 * The absence of a row is meaningful — it is how "no location was captured" is
 * represented, which is the normal case for every `nfc_card` meeting, since a
 * card tap proves proximity by physical range and has no GPS gate.
 */
import { z } from "zod";

import { accuracyMetresSchema, latitudeSchema, longitudeSchema, uuidSchema } from "./scalars";

export const meetingLocationRowSchema = z.object({
  /** Primary key as well as foreign key — one location row per meeting. */
  meeting_id: uuidSchema,
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  accuracy_m: accuracyMetresSchema,
  place_label: z.string().nullable(),
});

export type MeetingLocationRow = z.infer<typeof meetingLocationRowSchema>;
