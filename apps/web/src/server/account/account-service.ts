import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Self-serve account deletion — the service-layer half of
 * `public.soft_delete_own_account()` (20260815130300).
 *
 * ============================================================================
 * WHERE THE WORK ACTUALLY HAPPENS, AND WHY IT IS NOT HERE
 * ============================================================================
 *
 * This module is thin on purpose. Deleting an account changes four tables, and
 * §4.2 step 6's argument for the connect flow applies here word for word:
 * supabase-js has no client-side multi-statement transaction, so four PostgREST
 * calls are four independent transactions and any one of them can be the last
 * that runs. The partial states are security-relevant rather than untidy — the
 * worst one is "account marked deleted, cards not revoked", which leaves a
 * printed URL on a physical object still answering with the person's phone
 * number and email address for as long as the card exists.
 *
 * So the whole operation is one `plpgsql` function, which runs inside one
 * transaction by construction, and this file's only job is to call it and read
 * the answer. There is deliberately nothing here that could half-succeed.
 *
 * ============================================================================
 * WHY THE CALLER'S OWN RLS-BOUND CLIENT, NOT THE SERVICE ROLE
 * ============================================================================
 *
 * `soft_delete_own_account()` is `security definer` and takes NO ARGUMENTS: it
 * reads the subject from `private.current_user_id()`, i.e. from the JWT this
 * client is bound to. That is the whole security design, and it means the
 * dangerous mistake this feature could make — deleting the wrong person — is not
 * expressible. There is no user id for this file to get wrong, no parameter for
 * a bug to swap, and no path by which a caller could name somebody else.
 *
 * Handing it the service role instead would have meant a function taking a uuid,
 * and then the correctness of every deletion would rest on this TypeScript
 * passing the right one, with no second lock behind it. The migration header
 * records the same choice from the database's side.
 */

/**
 * What the database did, as reported by the RPC.
 *
 * The counts are for the confirmation the person sees afterwards and for the
 * server log. They are not used to decide anything: the operation either
 * committed in full or changed nothing at all, so "how many cards" is
 * information, never a partial-success signal.
 */
export interface AccountDeletionOutcome {
  /** True when the account was already deleted before this call. Idempotent, not an error. */
  alreadyDeleted: boolean;
  cardsRevoked: number;
  eventsCancelled: number;
  sessionsRevoked: number;
}

/**
 * The refusals `soft_delete_own_account()` can answer with. Each maps to a
 * sentence in `settings/actions.ts`; an unrecognised value is treated as a
 * failure rather than translated, so a reason added to the SQL without a
 * sentence here surfaces as an error instead of as silence.
 */
export type AccountDeletionRefusal =
  | "not_authenticated"
  | "user_not_found"
  | "account_not_active";

export class AccountDeletionRefusedError extends Error {
  constructor(readonly reason: AccountDeletionRefusal | string) {
    super(`The account could not be deleted (${reason}).`);
    this.name = "AccountDeletionRefusedError";
  }
}

/**
 * Soft-deletes the calling account, revoking its cards, cancelling the events
 * it hosts and burning its live presentation sessions — all in the one
 * transaction the RPC runs in.
 *
 * FAILS CLOSED IN BOTH DIRECTIONS, which is worth being precise about because
 * the two failures want opposite handling:
 *
 *   * A transport or database FAILURE throws. The transaction rolled back, so
 *     nothing changed, and the caller must not sign the person out or tell them
 *     anything succeeded — a "your account is deleted" screen over an account
 *     that is still live is the one outcome this feature must never produce.
 *   * A REFUSAL (`{ok: false, reason}`) throws too, as
 *     `AccountDeletionRefusedError`, so the two cannot be confused at the call
 *     site. The caller turns the reason into a sentence.
 *
 * A malformed answer — no `ok`, or a shape this does not recognise — is treated
 * as a failure rather than as success. `config.ts`'s rule, one layer out: a
 * value that quietly defaults is a claim nobody made, and the claim here would
 * be "your account is gone".
 */
export async function softDeleteOwnAccount(
  supabase: SupabaseClient,
): Promise<AccountDeletionOutcome> {
  const { data, error } = await supabase.rpc("soft_delete_own_account");

  if (error) {
    throw new Error(`Failed to delete the account: ${error.message}`, { cause: error });
  }

  const result = (data ?? null) as Record<string, unknown> | null;
  if (result === null || typeof result.ok !== "boolean") {
    throw new Error(
      "soft_delete_own_account returned an answer this app does not recognise, so the " +
        "account is being treated as NOT deleted.",
    );
  }

  if (!result.ok) {
    throw new AccountDeletionRefusedError(
      typeof result.reason === "string" ? result.reason : "unknown",
    );
  }

  return {
    alreadyDeleted: result.already_deleted === true,
    cardsRevoked: numberOrZero(result.cards_revoked),
    eventsCancelled: numberOrZero(result.events_cancelled),
    sessionsRevoked: numberOrZero(result.sessions_revoked),
  };
}

/**
 * The counts are absent on the already-deleted answer (nothing was written, so
 * there is nothing to count) and are display-only everywhere else, so a missing
 * or non-numeric value reads as zero rather than failing the operation. This is
 * the one place in this module where a default is correct: the decision has
 * already been made and committed by the time these are read.
 */
function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
