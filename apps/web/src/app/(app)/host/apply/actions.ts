"use server";

import { revalidatePath } from "next/cache";
import { submitHostApplicationInputSchema } from "@smartcard/types";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { safeActionErrorMessage } from "@/server/errors";
import { submitHostApplication } from "@/server/hosting/host-application-service";
import type { HostApplicationActionState } from "./action-state";

/**
 * The Server Action behind `/host/apply`.
 *
 * A Server Action is a reachable POST endpoint on its own, not only through
 * this page — the same note every `actions.ts` here carries — so this
 * re-derives the caller from a fresh `getAuthenticatedContext()` and then
 * stops: whether the caller may apply at all (an active account) and what
 * counts as a required field are decided inside `submit_host_application`
 * itself, from values it reads and re-trims. Nothing here is the gate.
 */
export async function submitHostApplicationAction(
  _prevState: HostApplicationActionState,
  formData: FormData,
): Promise<HostApplicationActionState> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    return { error: "You need to be signed in to apply." };
  }

  const parsed = submitHostApplicationInputSchema.safeParse({
    organizationName: formData.get("organizationName"),
    applicantRole: formData.get("applicantRole"),
    pastEventLink: formData.get("pastEventLink"),
    // Empty optional fields arrive as "" from the form; the schema's `.optional()`
    // only skips a MISSING key, not an empty string, so an empty string is
    // turned into `undefined` here rather than stored as a zero-length note.
    expectedEventSize: emptyToUndefined(formData.get("expectedEventSize")),
    hostingFrequency: emptyToUndefined(formData.get("hostingFrequency")),
  });

  if (!parsed.success) {
    return { error: "Organization, your role, and a link to a past event are all required." };
  }

  try {
    await submitHostApplication(context.supabase, parsed.data);
  } catch (error) {
    return { error: safeActionErrorMessage(error, "hosting/apply") };
  }

  // The events page's own "apply" banner reads application status, and the
  // apply page itself re-renders as "pending" rather than the form. Both are
  // stale RSC payloads the moment this succeeds without this.
  revalidatePath("/host/apply");
  revalidatePath("/events");

  return { success: true };
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  return value;
}
