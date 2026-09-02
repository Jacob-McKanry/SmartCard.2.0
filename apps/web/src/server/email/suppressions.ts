import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The do-not-mail list (`public.email_suppressions`,
 * `20260902130000_table_email_suppressions.sql`). See that migration's own
 * header for why this table has no RLS policy and no `security definer` RPC —
 * unlike every other table this quarter's work has added, none of this
 * table's real callers (a webhook, a public unsubscribe link, a send job) run
 * with a Supabase user session, so there is no `current_user_id()` to key a
 * policy on.
 *
 * WHY THIS TAKES A `SupabaseClient` RATHER THAN CALLING `serviceRoleClient()`
 * ITSELF, EVEN THOUGH EVERY REAL CALLER PASSES THE SAME ONE. Every other
 * service function in this codebase (`importEventAttendees`, `cancelEvent`,
 * `submitHostApplication`, …) takes its client as a parameter rather than
 * reaching for a singleton, and for the same reason here as there: a module
 * that constructs its own client is a module a Vitest run cannot hand a fake
 * to. The three real call sites (the Resend webhook, the unsubscribe route,
 * the send job) each pass `serviceRoleClient()` explicitly — see
 * `service-role-client.ts`'s own warning that adding a caller is a decision,
 * made once at each of those three sites rather than hidden inside this file.
 */
export type SuppressionReason = "bounced" | "complained" | "unsubscribed";

/**
 * Whether mail may go to this address at all. Called by the send job
 * (a later slice) immediately before every message — never cached, because a
 * bounce recorded a minute ago must stop the very next send.
 *
 * FAILS CLOSED: a read error answers `true` (suppressed), the wrong direction
 * to be wrong in for a do-not-mail list. `false` from an outage would mean a
 * transient database error becomes silent permission to mail somebody who
 * unsubscribed — the one failure mode this whole table exists to prevent.
 */
export async function isEmailSuppressed(
  supabase: SupabaseClient,
  email: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("email_suppressions")
    .select("email")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (error) {
    console.error("[email/suppressions] isEmailSuppressed failed closed", {
      error: error.message,
      cause: JSON.stringify(error),
    });
    return true;
  }
  return data !== null;
}

/**
 * Records a suppression. A duplicate is swallowed as success (see below) —
 * see the migration's own comment on `reason`: this table is a boolean gate,
 * not an event log, so a second bounce or complaint for an already-suppressed
 * address does not need its own row.
 */
export async function recordSuppression(
  supabase: SupabaseClient,
  email: string,
  reason: SuppressionReason,
  sourceEventId?: string,
): Promise<void> {
  const { error } = await supabase.from("email_suppressions").insert({
    email: email.trim().toLowerCase(),
    reason,
    source_event_id: sourceEventId ?? null,
  });

  // 23505: already suppressed. Not an error from this function's point of
  // view — the end state the caller wanted (this address is on the list) is
  // already true, same posture `inviteToEvent`'s own duplicate-insert handling
  // takes for the identical reason.
  if (error && error.code !== "23505") {
    throw new Error(`Failed to record an email suppression: ${error.message}`, { cause: error });
  }
}
