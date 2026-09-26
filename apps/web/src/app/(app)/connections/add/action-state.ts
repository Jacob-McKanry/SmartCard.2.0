/**
 * The `useActionState` result shape for this route's Server Actions.
 *
 * Same reasoning as `apps/web/src/app/(app)/connections/[connectionId]/action-state.ts`:
 * a file marked `"use server"` may only export async functions, so the plain
 * type and constant need a home outside that boundary.
 */
export interface AddContactActionState {
  error?: string;
  success?: boolean;
  /** Set on success so the caller can navigate to the new connection or contact. */
  connectionId?: string;
  otherUserId?: string;
}

export const initialAddContactActionState: AddContactActionState = {};
