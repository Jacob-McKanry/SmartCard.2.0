/**
 * The `useActionState` result shape for submitting a guest-list claim.
 *
 * Own module rather than living in `actions.ts`, for the reason every other
 * feature here has one: a `"use server"` file may only export async
 * functions.
 *
 * No `success` counts, unlike `AttendeeImportActionState` — there is nothing
 * to enumerate here, `claimed` is the whole answer (§3.6: `claim_event_import`
 * says nothing beyond a boolean, and this state does not invent detail the
 * database refused to give).
 */
export interface ClaimActionState {
  claimed?: boolean;
  error?: string;
}

export const initialClaimActionState: ClaimActionState = {};
