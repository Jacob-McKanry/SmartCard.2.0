import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The 18+/terms gate (owner decision 11,
 * `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`) — the
 * service-layer half of `public.accept_terms_and_confirm_age` /
 * `public.my_eligibility` (`supabase/migrations/20261009120000_users_eligibility_age_and_terms.sql`).
 *
 * The caller's own RLS-bound client, never the service role: both RPCs are
 * `security definer`, derive the subject from the JWT, and take no user id —
 * the same reasoning `account-service.ts` gives for `soft_delete_own_account`.
 * There is no argument for this file to get wrong.
 *
 * NOT WIRED INTO THE LIVE APP YET. Per the owner's explicit instruction, the
 * gate screen that calls this is built only under the admin-gated `/MapTest`
 * route until the owner says to bring it live — see the amendment's §9.
 */

export interface EligibilityState {
  needsAgeGate: boolean;
  /** Null until accepted, or if the account's date of birth is somehow unset. */
  age: number | null;
}

export type AcceptTermsRefusal =
  | "not_authenticated"
  | "unavailable"
  | "underage"
  | "invalid_date"
  | "terms_version_mismatch";

export class AcceptTermsRefusedError extends Error {
  constructor(readonly reason: AcceptTermsRefusal | string) {
    super(`The age/terms gate refused this submission (${reason}).`);
    this.name = "AcceptTermsRefusedError";
  }
}

/** The caller's own gate state. Never reveals a raw date of birth — see the migration header. */
export async function myEligibility(supabase: SupabaseClient): Promise<EligibilityState> {
  const { data, error } = await supabase.rpc("my_eligibility");

  if (error) {
    throw new Error(`Failed to read eligibility state: ${error.message}`, { cause: error });
  }

  const result = (data ?? null) as Record<string, unknown> | null;
  if (result === null || typeof result.needs_age_gate !== "boolean") {
    // Fail closed, matching the RPC's own posture: an answer this app does
    // not recognise is treated as "still gated", never as "cleared".
    return { needsAgeGate: true, age: null };
  }

  return {
    needsAgeGate: result.needs_age_gate,
    age: typeof result.age === "number" ? result.age : null,
  };
}

/**
 * Submits a date of birth and the terms version being accepted.
 *
 * `dateOfBirth` is an ISO `YYYY-MM-DD` string — the RPC is write-once for an
 * account that already has one on file, so a returning member re-accepting a
 * bumped terms version may pass any value here; the database ignores it.
 *
 * `underage` is THE FINAL BLOCK (migration header, step 4): once logged, this
 * account is refused permanently, on every future call, regardless of what is
 * submitted. There is no retry path, by design.
 */
export async function acceptTermsAndConfirmAge(
  supabase: SupabaseClient,
  dateOfBirth: string,
  termsVersion: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("accept_terms_and_confirm_age", {
    p_date_of_birth: dateOfBirth,
    p_terms_version: termsVersion,
  });

  if (error) {
    throw new Error(`Failed to submit the age/terms gate: ${error.message}`, { cause: error });
  }

  const result = (data ?? null) as Record<string, unknown> | null;
  if (result === null || typeof result.ok !== "boolean") {
    throw new Error(
      "accept_terms_and_confirm_age returned an answer this app does not recognise.",
    );
  }

  if (!result.ok) {
    throw new AcceptTermsRefusedError(
      typeof result.reason === "string" ? result.reason : "unknown",
    );
  }
}
