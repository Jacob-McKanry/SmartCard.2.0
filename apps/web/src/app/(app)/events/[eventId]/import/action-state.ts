import type { AttendeeImportSummary } from "@smartcard/types";

/**
 * The `useActionState` result shape for the guest-list import.
 *
 * Its own module, separate from `actions.ts`, for the reason every other
 * feature here has one: a file marked `"use server"` may only export async
 * functions, so a plain type or constant needs a home outside that boundary.
 *
 * `summary` is the whole reason this is not a bare success flag. An import is
 * four different outcomes at once — some guests are new, some rows corrected
 * ones already uploaded, some had no usable email, and some belong to people
 * who have already claimed and were therefore left alone. A host who uploads a
 * corrected file and sees only "done" has no way to tell whether the correction
 * landed. Rendering the counts is what makes a re-upload an inspectable action
 * rather than a hopeful one.
 */
export interface AttendeeImportActionState {
  error?: string;
  success?: boolean;
  /** Present exactly when `success` is true. Counts only, never a list of who. */
  summary?: AttendeeImportSummary;
}

export const initialAttendeeImportActionState: AttendeeImportActionState = {};
