/**
 * `public.event_rsvps` — see 20260809210300_table_events_and_event_rsvps.sql and
 * 20260814051200_fn_event_rsvp_write_path.sql
 *
 * One answer per person per event. Row access is narrow (your own plus your
 * connections'): the full attendee list is deliberately unreadable, and
 * "you know 4 people going" is computed by a security definer function rather
 * than answered with rows (§3.3).
 *
 * THERE IS NO INSERT OR UPDATE SCHEMA IN THIS FILE, AND THAT IS THE POINT.
 * `authenticated` holds SELECT and nothing else on this table since
 * 20260814051200. Every write goes through `public.request_event_rsvp`,
 * `public.withdraw_event_rsvp` or `public.decide_event_rsvp`, because `going`
 * means different real things depending on the event's capacity and approval
 * settings — a client that could write it directly could approve itself past
 * the host's gate, take a seat at a full event, and (since `going` is a branch
 * of the `users` read policy via `private.shares_event_with()`) hand itself
 * profile visibility. The RPC argument shapes live in `rsvpIntentSchema` and
 * `rsvpDecisionSchema` in `./enums`; a row-shaped write schema here would
 * describe a capability that does not exist.
 */
import { z } from "zod";

import { timestamptzSchema, uuidSchema } from "./scalars";
import { rsvpStatusSchema } from "./enums";

export const eventRsvpRowSchema = z.object({
  id: uuidSchema,
  event_id: uuidSchema,
  user_id: uuidSchema,
  status: rsvpStatusSchema,

  /**
   * When this person last gave this answer. Also the waitlist's FIFO key, which
   * is why the RPCs leave it alone on a host decision or a system promotion:
   * rewriting it would reshuffle a queue that is supposed to reflect the order
   * people actually asked in.
   */
  responded_at: timestamptzSchema,

  /**
   * The host who approved or denied this row. Read together with `decided_at`:
   *
   *   both null                      no host decision has ever been made
   *   both set                       a host decided, and this is who
   *   decided_at set, decided_by null  the system promoted this row off the
   *                                    waitlist when a seat freed — nobody
   *                                    decided, so naming a person would be a
   *                                    false audit record
   */
  decided_by: uuidSchema.nullable(),
  decided_at: timestamptzSchema.nullable(),

  /**
   * `true` when a host deliberately admitted this person past a full event's
   * cap. Recorded rather than silent so an over-capacity event is explainable
   * afterwards instead of just looking like arithmetic that does not add up.
   */
  capacity_override: z.boolean(),
});

export type EventRsvpRow = z.infer<typeof eventRsvpRowSchema>;
