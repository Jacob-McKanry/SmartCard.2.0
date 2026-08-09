/**
 * `public.meeting_participants` — see 20260809210500_table_meetings.sql
 *
 * Who was at a meeting, plus each person's own privacy choices. Meetings are
 * pairwise by construction (one presenter, one scanner); the §3.2 location
 * policy relies on that, so introducing group meetings means revisiting that
 * policy, not just this table.
 */
import { z } from "zod";

import { uuidSchema } from "./scalars";

export const meetingParticipantRowSchema = z.object({
  meeting_id: uuidSchema,
  user_id: uuidSchema,

  /**
   * Defaults to false. The location policy is written as "prove nobody
   * objected" rather than "prove everybody agreed", so an untouched row blocks
   * sharing — the correct direction to fail in for location data.
   */
  location_share_consent: z.boolean(),

  /**
   * The per-participant veto. Setting it hides the meeting from everyone but
   * the two people who were there, and the other party has no policy that can
   * reverse it.
   */
  marked_private: z.boolean(),
});

export type MeetingParticipantRow = z.infer<typeof meetingParticipantRowSchema>;

/**
 * The fields a participant may change on their own row, mirroring the
 * column-level UPDATE grant in 20260809211200. Participants cannot be added or
 * removed by a client at all — participation is a fact the verification service
 * establishes, not a claim.
 */
export const meetingParticipantConsentUpdateSchema = meetingParticipantRowSchema
  .pick({ location_share_consent: true, marked_private: true })
  .partial();

export type MeetingParticipantConsentUpdate = z.infer<typeof meetingParticipantConsentUpdateSchema>;
