/**
 * The `useActionState` result shape shared by every Profile Server Action.
 *
 * Lives in its own module, separate from `actions.ts`, because a file marked
 * `"use server"` may only export async functions — Next.js's build enforces
 * this so nothing but a callable action reference ships to the client
 * bundle. A plain type and a plain constant both need a home outside that
 * boundary.
 */
export interface ActionState {
  error?: string;
  success?: boolean;
}

export const initialActionState: ActionState = {};
