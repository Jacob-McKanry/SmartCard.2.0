import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resend } from "resend";

import { emailMailingAddress, kindeSiteUrl } from "@/server/env";
import { buildClaimEmail } from "./claim-email";
import { isEmailSuppressed } from "./suppressions";
import { signUnsubscribeToken } from "./unsubscribe-token";

/**
 * `invites.smartcard.tech` — the sending subdomain decided in
 * `docs/architecture/2026-09-02-event-invite-email.md` §0, isolating bulk-
 * mail reputation from `smartcard.tech` itself. Not a secret and not
 * environment-dependent (this app has no staging Resend domain today), so a
 * plain constant rather than an `env.ts` accessor — unlike every secret this
 * phase added, there is nothing here a leak or a wrong value would expose
 * beyond a wrong From header.
 */
const FROM_ADDRESS = "SmartCard <invites@invites.smartcard.tech>";

export type SendClaimEmailResult =
  | { outcome: "sent" }
  | { outcome: "suppressed" }
  | { outcome: "failed"; error: string };

/**
 * One row, one email — the "send module" `docs/architecture/2026-09-02-event-invite-email.md`
 * Phase 3 promised. Never throws: every outcome, including a Resend API
 * failure, is a value the caller inspects, because a batch of hundreds of
 * these calls must not abort on the first bad address.
 *
 * WHAT THIS DOES NOT DO: DECIDE WHEN OR HOW MANY ROWS GET SENT. That is
 * §0/Phase 4's job (the trigger and the queue), deliberately kept out of
 * this function — see this module's own header note in the architecture
 * doc for why the two were NOT built together in the same slice despite
 * Phase 3's original description saying "called from importEventAttendees":
 * a resumable, non-blocking dispatch mechanism for up to 5,000 rows is its
 * own design problem, and bolting a half-considered version of it onto this
 * function would risk the two needing to be redesigned together later
 * anyway. This function is the unit Phase 4 will call in a loop.
 *
 * WRITE-BACK IS GUARDED BY `claimed_by_user_id is null`, THE SAME RACE
 * `claim_event_import` ALREADY GUARDS AGAINST. A row can be claimed between
 * this function reading it (by its caller) and finishing a send attempt —
 * claiming already nulls `emailed_at`/`email_error` in the same atomic
 * statement (20260902140000), and a slow send attempt finishing afterward
 * must not resurrect either column on a row whose PII the claim just
 * destroyed.
 */
export async function sendClaimEmail(
  deps: { supabase: SupabaseClient; resend: Pick<Resend, "emails"> },
  event: { title: string; hostFirstName: string | null },
  row: { id: string; email: string; firstName: string | null; lookupToken: string },
): Promise<SendClaimEmailResult> {
  const { supabase, resend } = deps;

  if (await isEmailSuppressed(supabase, row.email)) {
    await writeBack(supabase, row.id, { email_error: "suppressed" });
    return { outcome: "suppressed" };
  }

  const origin = kindeSiteUrl();
  const content = buildClaimEmail({
    recipientFirstName: row.firstName,
    hostFirstName: event.hostFirstName,
    eventTitle: event.title,
    claimUrl: `${origin}/claim/${row.lookupToken}`,
    unsubscribeUrl: `${origin}/api/unsubscribe?email=${encodeURIComponent(row.email)}&sig=${encodeURIComponent(signUnsubscribeToken(row.email))}`,
    mailingAddress: emailMailingAddress(),
  });

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: row.email,
    subject: content.subject,
    html: content.html,
    text: content.text,
    headers: {
      // RFC 8058 one-click unsubscribe, the same endpoint the link in the
      // body points at — see `/api/unsubscribe`'s own header for why both
      // GET and POST do the same thing.
      "List-Unsubscribe": `<${origin}/api/unsubscribe?email=${encodeURIComponent(row.email)}&sig=${encodeURIComponent(signUnsubscribeToken(row.email))}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  if (error) {
    await writeBack(supabase, row.id, { email_error: error.message });
    return { outcome: "failed", error: error.message };
  }

  await writeBack(supabase, row.id, { emailed_at: new Date().toISOString(), email_error: null });
  return { outcome: "sent" };
}

async function writeBack(
  supabase: SupabaseClient,
  importRowId: string,
  fields: { emailed_at?: string; email_error: string | null },
): Promise<void> {
  const { error } = await supabase
    .from("event_attendee_imports")
    .update(fields)
    .eq("id", importRowId)
    .is("claimed_by_user_id", null);

  if (error) {
    // Not rethrown: the email itself was already sent (or its failure
    // already decided) by the time this runs, and a lost write-back means
    // at worst a row gets attempted again later — annoying, never unsafe.
    // A thrown error here would abort a batch loop over one bookkeeping
    // write, which is a worse failure than a possible duplicate send.
    console.error("[email/send-claim-email] failed to record send outcome", {
      importRowId,
      error: error.message,
    });
  }
}
