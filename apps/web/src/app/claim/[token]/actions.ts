"use server";

import { claimApprovedFieldsSchema } from "@smartcard/types";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { safeActionErrorMessage, UserFacingError } from "@/server/errors";
import { claimEventImport } from "@/server/events/claim-service";
import type { ClaimActionState } from "./action-state";

/**
 * The Server Action behind the claim-review screen's submit button.
 *
 * SAME SECURITY NOTE EVERY `actions.ts` IN THIS APP CARRIES
 *
 * A Server Action is a POST endpoint reachable by anyone who can send the
 * same request, not only by somebody who loaded this page first. So this
 * re-derives the caller from a fresh `getAuthenticatedContext()` and hands
 * that context's RLS-bound client to the service — never the service role,
 * never a caller id trusted from anywhere but the freshly verified session.
 *
 * And then it stops. Whether `lookupToken` resolves to a live row, whether
 * the caller's live email matches it, whether that email is verified or the
 * account predates the import, and both rate limits are all re-derived inside
 * `claim_event_import` (20260828130000) from values it reads itself — the
 * exact posture `import-service.ts`'s own actions file already documents for
 * its RPC. A caller who never loaded this page and posts here directly with a
 * token that is not theirs meets the identical gate.
 *
 * WHY THE APPROVED FIELDS ARE READ AS CHECKBOXES, NOT TRUSTED WHOLESALE
 *
 * `formData` is attacker-controlled the same way any Server Action's is.
 * `claimApprovedFieldsSchema` is permissive on purpose (every key optional,
 * unknown keys ignored) because the only thing that matters is which of the
 * six named booleans came through as the literal string `"on"` — anything
 * else, including a forged `"true"` for a field the caller was never shown a
 * checkbox for, still only says "keep this field if the row has one", which
 * `claim_event_import` re-derives from the row it already owns. There is
 * nothing to escalate by sending extra `true`s.
 */
export async function claimEventImportAction(
  lookupToken: string,
  _prevState: ClaimActionState,
  formData: FormData,
): Promise<ClaimActionState> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    // Fail closed (CLAUDE.md): an action invoked with no valid session is
    // refused outright, never treated as an anonymous request for nothing.
    return { error: "You need to be signed in to do that." };
  }

  const approvedFields = claimApprovedFieldsSchema.parse({
    first_name: formData.get("first_name") === "on",
    last_name: formData.get("last_name") === "on",
    phone_number: formData.get("phone_number") === "on",
    company_name: formData.get("company_name") === "on",
    company_role: formData.get("company_role") === "on",
    social_links: formData.get("social_links") === "on",
  });

  try {
    const { claimed } = await claimEventImport(context.supabase, lookupToken, approvedFields);

    if (!claimed) {
      // §3.6: this is the identical shape for "wrong token", "already
      // claimed", "expired", "wrong email" and "rate-limited". This screen
      // cannot know which happened and does not guess — see claim-review.tsx.
      throw new UserFacingError(
        "This link couldn't be used to claim a profile. It may have expired, already been used, or not apply to this account.",
      );
    }

    return { claimed: true };
  } catch (error) {
    return { error: safeActionErrorMessage(error, "events/claim") };
  }
}
