import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claimableImportSchema,
  claimEventImportResultSchema,
  type ClaimableImport,
  type ClaimApprovedFields,
  type ClaimEventImportResult,
} from "@smartcard/types";

/**
 * The service layer (§1.7) for C4 of the claim flow —
 * `docs/architecture/2026-08-22-event-attendee-import.md` §3.8/§4.2.
 *
 * TWO FUNCTIONS, ONE PER RPC, AND NEITHER DECIDES ANYTHING
 *
 * Same posture as `attendee-import-service.ts` and `card-claim-service.ts`:
 * every authorization question — does the token resolve to a live row, does
 * the caller's live email match it, is it verified or does the account
 * predate the import, are either rate limit exhausted — is answered inside
 * `get_claimable_import` / `claim_event_import` (20260828120000,
 * 20260828130000, 20260828140000) from values those functions read
 * themselves. This file only calls them through the caller's own RLS-bound
 * client and turns the response into a typed value.
 *
 * WHY BOTH FUNCTIONS FAIL CLOSED TO THE SAME "NOT AVAILABLE" SHAPE, RATHER
 * THAN THROWING ON A TRANSPORT ERROR
 *
 * §3.6 requires every refusal to be indistinguishable — no such token,
 * expired, already claimed, wrong email, rate-limited. That property is only
 * real if a transport failure or a missing `app_config` row (which
 * `get_claimable_import` surfaces as a *thrown* `55000`, not a graceful
 * `{available: false}` — see that migration) collapses into the identical
 * shape too. `card-preview-service.ts` and `isVerifiedHost` set the same
 * precedent: "every refusal looks the same... a missing config row and any
 * thrown error all produce one `null`." `getClaimableImport` follows that
 * exactly. `claimEventImportRpc` does not — a claim is a write a caller
 * expects to have *worked or not*, and a transport failure there is "we could
 * not ask", which the Server Action calling this needs to tell apart from "we
 * asked and the answer was no" so it can show a retry rather than a dead end.
 */

/**
 * Reads what an emailed claim link resolves to, for the caller currently
 * signed in.
 *
 * FAILS CLOSED TO `{available: false}` ON ANY ERROR — never throws. See the
 * header: a transport failure, a malformed response, and a genuine "no such
 * token" must render the identical screen, or the difference between them
 * becomes an oracle for whether a token is real.
 */
export async function getClaimableImport(
  supabase: SupabaseClient,
  lookupToken: string,
): Promise<ClaimableImport> {
  try {
    const { data, error } = await supabase.rpc("get_claimable_import", {
      p_lookup_token: lookupToken,
    });

    if (error) {
      console.error("[events/claim] get_claimable_import failed", {
        error: error.message,
        cause: JSON.stringify(error),
      });
      return { available: false };
    }

    const parsed = claimableImportSchema.safeParse(data);
    if (!parsed.success) {
      console.error("[events/claim] get_claimable_import returned an unexpected shape", {
        error: parsed.error.message,
      });
      return { available: false };
    }

    return parsed.data;
  } catch (error) {
    console.error("[events/claim] get_claimable_import threw", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { available: false };
  }
}

/**
 * Attempts to claim `lookupToken` for whoever `supabase` is authenticated as,
 * copying the fields named `true` in `approvedFields` into the caller's own
 * profile.
 *
 * Throws only on a transport or server failure — a REFUSED claim is a normal
 * outcome and comes back as `{ claimed: false }`, the same distinction
 * `claimUnassignedCard` draws for the identical reason.
 */
export async function claimEventImport(
  supabase: SupabaseClient,
  lookupToken: string,
  approvedFields: ClaimApprovedFields,
): Promise<ClaimEventImportResult> {
  const { data, error } = await supabase.rpc("claim_event_import", {
    p_lookup_token: lookupToken,
    p_approved_fields: approvedFields,
  });

  if (error) {
    throw new Error(`Failed to claim the guest-list profile: ${error.message}`, { cause: error });
  }

  const parsed = claimEventImportResultSchema.safeParse(data);
  if (!parsed.success) {
    // Defensive rather than decorative, matching `claimUnassignedCard`: an
    // unrecognised shape must read as "not claimed", never as success.
    throw new Error("claim_event_import returned an unexpected shape", { cause: parsed.error });
  }

  return parsed.data;
}
