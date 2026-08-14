/**
 * `public.event_invites` — see 20260814060000_table_event_invites.sql and
 * 20260814060100_rls_policies_event_invites_and_extend_can_see_event.sql
 *
 * Who has been invited to see a private event. Before this table existed, a
 * private event was visible to its host and to nobody else in practice:
 * `private.can_see_event()` admitted the host plus anyone already holding an
 * RSVP row, and since 20260814051200 an RSVP row can only be created by the
 * person it describes — so the only route in required already being in.
 *
 * AN INVITE GRANTS VISIBILITY, NEVER AN RSVP, AND THAT IS THE WHOLE DESIGN.
 * The row adds a branch to `can_see_event()` and does nothing else. The invitee
 * still calls `public.request_event_rsvp` themselves, and the approval gate,
 * capacity and waitlist rules then apply to them exactly as to anyone else. The
 * shortcut this deliberately does not take is having the inviter write the
 * invitee's RSVP: `status = 'going'` is a branch of the `users` read policy via
 * `private.shares_event_with()` (§3.4), so an RSVP row written by somebody other
 * than its subject would be a profile-visibility grant written by somebody else.
 *
 * THERE IS NO UPDATE SCHEMA IN THIS FILE, AND THAT IS DELIBERATE.
 * `authenticated` holds SELECT and a three-column INSERT, and no UPDATE or
 * DELETE grant or policy at all — there is no un-invite in this pass. A
 * row-shaped update schema here would describe a capability that does not
 * exist. See the policy migration's header for why a revoke is a reviewed pass
 * of its own rather than a missing DELETE policy: it would not remove the
 * visibility of anyone who has already RSVP'd, since the older RSVP branch of
 * `can_see_event()` still holds for them.
 *
 * There is no insert schema either. The three writable columns are supplied by
 * `inviteToEvent` in `apps/web/src/server/events/events-service.ts`, two of them
 * from the session rather than from client input, so there is no client-shaped
 * object to validate.
 */
import { z } from "zod";

import { timestamptzSchema, uuidSchema } from "./scalars";

export const eventInviteRowSchema = z.object({
  id: uuidSchema,
  event_id: uuidSchema,

  /** The person who may now see the event. */
  invited_user_id: uuidSchema,

  /**
   * Who sent it — the host, or an attendee holding a `going` RSVP; the INSERT
   * policy allows nobody else, and requires the invitee to be an existing
   * connection of whoever this is.
   *
   * Nullable because the column is `ON DELETE SET NULL`, the same treatment
   * `event_rsvps.decided_by` gets: if the inviter hard-deletes their account the
   * invite still happened, and the invitee must not silently lose sight of the
   * event because a third party closed theirs. `null` therefore means "the
   * inviter's account is gone", never "nobody invited them".
   */
  invited_by_user_id: uuidSchema.nullable(),

  /**
   * When the invite was sent. Not an expiry — invites do not lapse, and nothing
   * compares this against anything.
   */
  created_at: timestamptzSchema,
});

export type EventInviteRow = z.infer<typeof eventInviteRowSchema>;
