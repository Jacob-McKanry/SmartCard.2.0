import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reporting (owner decision 4,
 * `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`) — the
 * service-layer half of `public.submit_report`
 * (`supabase/migrations/20261009150100_reports_and_moderation.sql`). This is
 * the single TypeScript file allowed to call `submit_report`, asserted by
 * `no-second-write-path.test.ts`.
 *
 * The caller's own RLS-bound client: `submit_report` is `security definer`,
 * derives the reporter from the JWT, and requires
 * `private.has_safety_standing` — a real, prior relationship with the
 * subject (any connection, or the same event's roster population) — before
 * writing anything.
 *
 * NOT WIRED INTO THE LIVE APP YET. The report sheet is built only under the
 * admin-gated `/MapTest` route — see the amendment's §9.
 */

export const REPORT_CATEGORIES = [
  "harassment",
  "inappropriate_content",
  "spam",
  "safety_concern",
  "underage",
  "impersonation",
  "other",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export type SubmitReportRefusal =
  | "not_authenticated"
  | "unavailable"
  | "invalid_category"
  | "details_too_long"
  | "details_rejected"
  | "rate_limited";

export class SubmitReportRefusedError extends Error {
  constructor(readonly reason: SubmitReportRefusal | string) {
    super(`The report could not be submitted (${reason}).`);
    this.name = "SubmitReportRefusedError";
  }
}

/**
 * Files a report about `subjectUserId`.
 *
 * `unavailable` is deliberately identical whether `subjectUserId` names a
 * fake id, a real stranger, or the caller themself — see `submit_report`'s
 * own comment on why standing, not visibility, is the gate, and why that
 * refusal is honest about revealing only what the caller already knows
 * (that they have never crossed paths with whoever they named).
 */
export async function submitReport(
  supabase: SupabaseClient,
  subjectUserId: string,
  category: ReportCategory,
  details?: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("submit_report", {
    p_subject_user_id: subjectUserId,
    p_category: category,
    p_details: details ?? null,
  });

  if (error) {
    throw new Error(`Failed to submit the report: ${error.message}`, { cause: error });
  }

  const result = (data ?? null) as Record<string, unknown> | null;
  if (result === null || typeof result.ok !== "boolean") {
    throw new Error("submit_report returned an answer this app does not recognise.");
  }

  if (!result.ok) {
    throw new SubmitReportRefusedError(
      typeof result.reason === "string" ? result.reason : "unknown",
    );
  }
}
