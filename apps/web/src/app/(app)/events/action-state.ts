import type { RsvpStatus } from "@smartcard/types";

/**
 * The `useActionState` result shape shared by every Events Server Action.
 *
 * Lives in its own module, separate from `actions.ts`, for the same reason the
 * Profile feature's does: a file marked `"use server"` may only export async
 * functions, so a plain type or constant needs a home outside that boundary.
 *
 * `status` is here because an Events mutation has a result worth showing, not
 * just a success flag. The status a person *asked* for and the status the
 * database *stored* routinely differ — asking to go to an approval-gated event
 * stores `pending`, and asking to go to a full one stores `waitlist` — so the
 * UI has to render what came back rather than what it sent. `promoted` is the
 * same idea from the other side: withdrawing can move somebody else off the
 * waitlist in the same transaction, which is worth confirming to the person who
 * freed the seat.
 */
export interface EventActionState {
  error?: string;
  success?: boolean;
  /** The status now stored, or `null` after a withdrawal (no answer at all). */
  status?: RsvpStatus | null;
  /** How many people were promoted off the waitlist by this action. */
  promoted?: number;
  /** Set by `createEventAction` so the caller can navigate to the new event. */
  eventId?: string;
}

export const initialEventActionState: EventActionState = {};
