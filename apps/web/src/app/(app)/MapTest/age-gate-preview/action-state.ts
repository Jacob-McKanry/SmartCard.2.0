/**
 * The `useActionState` result shape for submitting the age/terms gate. Its
 * own module for the reason every `"use server"` file here has one — see
 * `admin/host-applications/action-state.ts`.
 */
export interface GateActionState {
  error?: string;
  done?: boolean;
}

export const initialGateActionState: GateActionState = {};
