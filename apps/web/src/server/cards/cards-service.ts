import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The service layer (§1.7) for owner-initiated card actions. Q28's in-app
 * activity record is this file's first caller, but the action itself
 * predates it: the RLS grant and policy have existed since
 * `20260809211100_rls_policies_identity_and_cards.sql` ("owners may revoke
 * or restore their own card") — nothing in application code ever called it
 * until now, which is worth recording because the architecture doc's Q28 row
 * assumed this already existed as a reusable building block. It didn't.
 *
 * Same posture as `connections-service.ts`: the caller's own RLS-bound
 * client, never the service role, with an explicit `.eq("owner_user_id", ...)`
 * filter even though the policy already enforces it — belt and braces.
 */

/**
 * Revokes one of the caller's own cards (`status: 'assigned' -> 'revoked'`) —
 * the kill switch §4.5 names for a lost or stolen card. The RLS policy's
 * `with check` also permits `revoked -> assigned` (an owner un-revoking their
 * own card), but no function here exposes that: Q28 only asked for the
 * revoke half, and adding a restore action nobody asked for is scope this
 * file doesn't need to carry.
 */
export async function revokeCard(supabase: SupabaseClient, cardId: string, ownerUserId: string): Promise<void> {
  const { data, error } = await supabase
    .from("cards")
    .update({ status: "revoked" })
    .eq("id", cardId)
    .eq("owner_user_id", ownerUserId)
    .eq("status", "assigned")
    .select("id");

  if (error) {
    throw new Error(`Failed to revoke card: ${error.message}`, { cause: error });
  }
  if (!data || data.length === 0) {
    throw new Error("This card couldn't be revoked — it may already be revoked or isn't yours.");
  }
}
