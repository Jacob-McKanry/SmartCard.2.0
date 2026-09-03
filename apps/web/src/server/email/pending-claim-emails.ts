import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resend } from "resend";

import { sendClaimEmail } from "./send-claim-email";

/**
 * The trigger and the batch loop `docs/architecture/2026-09-02-event-invite-email.md`
 * §4.2 deferred here from Phase 3. Called by
 * `/api/cron/send-claim-emails` — see that route's own header for the Vercel
 * Cron wiring; this module owns none of that and knows nothing about HTTP,
 * so it can be tested without a fake `Request`.
 *
 * WHY EVENT/HOST DETAILS ARE FETCHED ONCE FOR THE WHOLE BATCH, NOT PER ROW
 * A batch can span many events. Fetching `events`/`users` once per distinct
 * `event_id` in the batch, rather than once per row, is the difference
 * between O(events) and O(rows) queries for the same information.
 *
 * WHY ROWS ARE SENT IN CONCURRENT CHUNKS, NOT ONE AT A TIME — FOUND BUILDING
 * THIS, NOT ASSUMED IN THE ORIGINAL PLAN
 * The Vercel team this project deploys to is on the Hobby plan, confirmed via
 * `list_teams` while wiring this route: Vercel caps a Hobby function's
 * `maxDuration` at 10 seconds AND cron frequency at once per day (both
 * documented Vercel limits, not something this codebase configures). A
 * sequential `for await` loop — send one, wait, send the next — over even a
 * modest batch would blow through 10 seconds on network latency alone
 * (`sendClaimEmail` alone makes a suppression-check read, a Resend call, and
 * a write-back — three round trips per row). Sending is I/O-bound, so
 * `Promise.all` over a small chunk turns those into concurrent, not
 * sequential, latency. `email_send_concurrency` (`app_config`, default 5)
 * bounds how many rows run at once — high enough to fit a real batch inside
 * the 10-second ceiling, low enough to stay clear of Resend's default 10
 * req/sec team-wide rate limit even with each row's other Supabase calls
 * layered on top. See `20260903130000`'s migration header for the batch-size
 * correction this finding also required.
 */

export interface PendingClaimEmailsSummary {
  claimed: number;
  sent: number;
  suppressed: number;
  failed: number;
}

/**
 * @param resend `null` when `resendApiKey()` is unset — see that function's
 *   own header for why a missing key must degrade the feature rather than
 *   error the run. A `null` here claims nothing and returns all-zero counts;
 *   claiming rows a `null` client could not then send would strand them with
 *   a stamped `email_send_claimed_at` for no reason.
 */
export async function runPendingClaimEmailBatch(
  supabase: SupabaseClient,
  resend: Pick<Resend, "emails"> | null,
): Promise<PendingClaimEmailsSummary> {
  const zero: PendingClaimEmailsSummary = { claimed: 0, sent: 0, suppressed: 0, failed: 0 };
  if (resend === null) {
    return zero;
  }

  const config = await readConfig(supabase);
  if (config === null) {
    return zero;
  }

  const { data: rows, error } = await supabase.rpc("claim_pending_claim_emails", {
    p_limit: config.batchSize,
  });

  if (error) {
    console.error("[email/pending-claim-emails] claim_pending_claim_emails failed", {
      error: error.message,
    });
    return zero;
  }

  const claimed = (rows ?? []) as ImportRow[];
  if (claimed.length === 0) {
    return zero;
  }

  const eventContexts = await loadEventContexts(supabase, claimed);

  const summary: PendingClaimEmailsSummary = { claimed: claimed.length, sent: 0, suppressed: 0, failed: 0 };
  for (const chunk of toChunks(claimed, config.concurrency)) {
    const outcomes = await Promise.all(
      chunk.map((row) => {
        const event = eventContexts.get(row.event_id);
        if (event === undefined) {
          // The event was deleted between claiming this row and here — no
          // event to send about. Left with its lease stamped; the row will
          // not be picked up again until the lease expires (10 minutes),
          // which is fine for a case this rare rather than adding a
          // special-case delete.
          return Promise.resolve<"failed">("failed");
        }
        return sendClaimEmail(
          { supabase, resend },
          event,
          { id: row.id, email: row.email, firstName: row.first_name, lookupToken: row.lookup_token },
        ).then((result) => result.outcome);
      }),
    );
    for (const outcome of outcomes) {
      if (outcome === "sent") summary.sent += 1;
      else if (outcome === "suppressed") summary.suppressed += 1;
      else summary.failed += 1;
    }
  }

  return summary;
}

function toChunks<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

interface ImportRow {
  id: string;
  event_id: string;
  email: string;
  first_name: string | null;
  lookup_token: string;
}

async function readConfig(
  supabase: SupabaseClient,
): Promise<{ batchSize: number; concurrency: number } | null> {
  const { data, error } = await supabase
    .from("app_config")
    .select("key, value")
    .in("key", ["email_send_batch_size", "email_send_concurrency"]);

  if (error || data === null) {
    console.error("[email/pending-claim-emails] failed to read app_config", { error: error?.message });
    return null;
  }

  const byKey = new Map(data.map((row: { key: string; value: unknown }) => [row.key, Number(row.value)]));
  const batchSize = byKey.get("email_send_batch_size");
  const concurrency = byKey.get("email_send_concurrency");

  // Fail closed (CLAUDE.md): a missing or non-positive row means this run
  // sends nothing rather than guessing a number, matching the posture every
  // other app_config-fed function in this codebase already takes.
  if (
    batchSize === undefined || !Number.isFinite(batchSize) || batchSize <= 0 ||
    concurrency === undefined || !Number.isFinite(concurrency) || concurrency <= 0
  ) {
    console.error("[email/pending-claim-emails] email_send_batch_size/email_send_concurrency missing or invalid", {
      batchSize,
      concurrency,
    });
    return null;
  }

  return { batchSize, concurrency };
}

async function loadEventContexts(
  supabase: SupabaseClient,
  rows: readonly ImportRow[],
): Promise<Map<string, { title: string; hostFirstName: string | null }>> {
  const eventIds = [...new Set(rows.map((row) => row.event_id))];
  const { data, error } = await supabase
    .from("events")
    .select("id, title, host:users!events_host_user_id_fkey(first_name)")
    .in("id", eventIds);

  const map = new Map<string, { title: string; hostFirstName: string | null }>();
  if (error || data === null) {
    console.error("[email/pending-claim-emails] failed to load event/host context", {
      error: error?.message,
    });
    return map;
  }
  for (const row of data as unknown as {
    id: string;
    title: string;
    host: { first_name: string | null } | null;
  }[]) {
    map.set(row.id, { title: row.title, hostFirstName: row.host?.first_name ?? null });
  }
  return map;
}
