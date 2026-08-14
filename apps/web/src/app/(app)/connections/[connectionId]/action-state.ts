/**
 * The `useActionState` result shape shared by this route's Server Actions.
 *
 * Same reasoning as `apps/web/src/app/profile/action-state.ts`: a file marked
 * `"use server"` may only export async functions, so the plain type and
 * constant need a home outside that boundary.
 */
export interface ActionState {
  error?: string;
  success?: boolean;
}

export const initialActionState: ActionState = {};
