/**
 * `public.meetings` — see 20260809210500_table_meetings.sql
 *
 * Non-sensitive metadata for one verified in-person meeting. Coordinates
 * deliberately live in `meeting_locations`, behind a stricter policy, so that a
 * forgotten join produces missing location data rather than leaked location
 * data (§2.4).
 */
import { z } from "zod";

import { timestamptzSchema, uuidSchema } from "./scalars";
import { locationVisibilitySchema, verificationMethodSchema } from "./enums";

export const meetingRowSchema = z.object({
  id: uuidSchema,
  occurred_at: timestamptzSchema,
  verification_method: verificationMethodSchema,

  /**
   * Non-null and unique. Non-null because every meeting must trace to a
   * verification session — that is the product's non-negotiable rule expressed
   * structurally. Unique because sessions are single-use, so one session
   * producing two meetings would mean a replay succeeded.
   */
  verification_session_id: uuidSchema,

  event_id: uuidSchema.nullable(),

  /** Meeting-level privacy flag; either participant may change it. */
  is_private: z.boolean(),

  /**
   * Opting in to `mutuals` is necessary but not sufficient for a mutual to see
   * coordinates: every participant must also have consented and none may have
   * marked the meeting private (§3.2).
   */
  location_visibility: locationVisibilitySchema,

  created_at: timestamptzSchema,
});

export type MeetingRow = z.infer<typeof meetingRowSchema>;

/**
 * The two meeting-level fields a participant is allowed to change, mirroring
 * the column-level UPDATE grant in 20260809211200.
 *
 * Note these are the flags either participant can change, including undoing the
 * other's change. The veto a counterpart cannot override is
 * `meeting_participants.marked_private`.
 */
export const meetingPrivacyUpdateSchema = meetingRowSchema
  .pick({ is_private: true, location_visibility: true })
  .partial();

export type MeetingPrivacyUpdate = z.infer<typeof meetingPrivacyUpdateSchema>;
