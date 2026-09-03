import "server-only";

import { Resend } from "resend";

import { cronSecret, resendApiKey } from "@/server/env";
import { runPendingClaimEmailBatch } from "@/server/email/pending-claim-emails";
import { serviceRoleClient } from "@/server/supabase/service-role-client";

/**
 * `/api/cron/send-claim-emails` — Phase 4 of
 * `docs/architecture/2026-09-02-event-invite-email.md`. Vercel Cron hits this
 * on the schedule declared in `vercel.json`; each call claims and attempts to
 * send one batch of pending claim-invite emails (`email_send_batch_size` in
 * `app_config`, currently 50) via `runPendingClaimEmailBatch`.
 *
 * WHY THIS ROUTE OWNS ALMOST NOTHING. Everything that could be wrong here —
 * the atomic claim, the suppression check, the send, the write-back — lives
 * in `claim_pending_claim_emails` (the migration), `sendClaimEmail`, and
 * `runPendingClaimEmailBatch`, each independently tested. This route is the
 * thin HTTP shell those three need: verify the caller is actually Vercel
 * Cron, construct a Resend client if one can be, call the batch function,
 * report what happened.
 *
 * WHY THE BEARER CHECK, AND WHY IT FAILS CLOSED
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically once the
 * route is declared in `vercel.json` and the env var is set — see
 * `cronSecret()`'s own header for what an unauthenticated version of this
 * route would let a stranger trigger. `cronSecret()` itself throws if unset
 * (required, not optional), so a misconfigured deploy 500s every call rather
 * than silently accepting unverified requests — the identical fail-closed
 * shape `resendWebhookSecret()` already established for the bounce/complaint
 * webhook.
 *
 * `maxDuration = 10` DOCUMENTS A CEILING, NOT A REQUEST. This project's
 * Vercel team is on the Hobby plan (confirmed via `list_teams` while wiring
 * this route), which caps every function — cron included — at 10 seconds
 * regardless of what this constant says, and caps cron frequency at once per
 * day. `pending-claim-emails.ts`'s own header explains why that ceiling
 * shaped `email_send_concurrency` rather than being routed around, and
 * `20260903130000`'s migration explains the resulting `email_send_batch_size`
 * correction. Written here explicitly so raising it is a deliberate act (on
 * a Pro plan, both this number and `vercel.json`'s schedule can go up
 * together) rather than a forgotten constant nobody remembers to revisit.
 */
export const maxDuration = 10;
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${cronSecret()}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const apiKey = resendApiKey();
  const resend = apiKey === null ? null : new Resend(apiKey);

  const summary = await runPendingClaimEmailBatch(serviceRoleClient(), resend);

  return Response.json({ ok: true, ...summary });
}
