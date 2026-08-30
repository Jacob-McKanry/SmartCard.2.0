/**
 * The `useActionState` result shape for submitting a host application.
 *
 * Its own module, separate from `actions.ts`, for the reason every other
 * `"use server"` file in this app has one: that file may only export async
 * functions, so a plain type needs a home outside it.
 */
export interface HostApplicationActionState {
  error?: string;
  success?: boolean;
}

export const initialHostApplicationActionState: HostApplicationActionState = {};
