/**
 * The `useActionState` result shape for approving or rejecting one
 * application. Its own module for the reason every `"use server"` file here
 * has one — see `events/[eventId]/import/action-state.ts`.
 */
export interface DecideHostApplicationActionState {
  error?: string;
}

export const initialDecideHostApplicationActionState: DecideHostApplicationActionState = {};
