"use server";

import { revalidatePath } from "next/cache";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { safeActionErrorMessage } from "@/server/errors";
import {
  AcceptTermsRefusedError,
  acceptTermsAndConfirmAge,
} from "@/server/safety/eligibility-service";
import type { GateActionState } from "./action-state";

/**
 * `AcceptTermsRefusedError` is not a `UserFacingError`, so by default it
 * would collapse to the generic message — the same posture
 * `AccountDeletionRefusedError` takes at the web layer. This gate's own
 * refusal reasons are mapped to real sentences anyway, deliberately: they
 * describe the caller's own submission about themself (their own date of
 * birth, their own stale page), not anyone else's data, so there is nothing
 * §4.2's "never confirm or deny more than necessary" would withhold here.
 */
function gateRefusalMessage(reason: string): string {
  switch (reason) {
    case "underage":
      return "You must be 18 or older to use SmartCard.";
    case "invalid_date":
      return "That doesn't look like a valid date of birth.";
    case "terms_version_mismatch":
      return "This page is out of date — reload and try again.";
    case "unavailable":
      return "The age/terms gate isn't configured yet.";
    case "not_authenticated":
      return "You need to be signed in to do that.";
    default:
      return "That submission couldn't be processed.";
  }
}

/**
 * Preview-only: a real session should never reach `accept_terms_and_confirm_age`
 * except through this one call site while this route is `/MapTest`-only. See
 * the page header.
 */
export async function acceptGateAction(
  _prevState: GateActionState,
  formData: FormData,
): Promise<GateActionState> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    return { error: "You need to be signed in to do that." };
  }

  const dateOfBirth = formData.get("dateOfBirth");
  if (typeof dateOfBirth !== "string" || dateOfBirth.trim() === "") {
    return { error: "Enter a date of birth." };
  }

  if (formData.get("acceptTerms") !== "on") {
    return { error: "You need to accept the terms to continue." };
  }

  try {
    await acceptTermsAndConfirmAge(context.supabase, dateOfBirth, "1");
  } catch (error) {
    if (error instanceof AcceptTermsRefusedError) {
      return { error: gateRefusalMessage(error.reason) };
    }
    return { error: safeActionErrorMessage(error, "safety/age-gate") };
  }

  revalidatePath("/MapTest/age-gate-preview");
  return { done: true };
}
