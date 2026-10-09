import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Admin moderation (owner decision 14,
 * `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`): suspend,
 * unsuspend, dismiss a report. No permanent bans or warnings at launch — the
 * service-layer half of `public.admin_list_reports` /
 * `public.admin_resolve_report` / `public.admin_suspend_user` /
 * `public.admin_unsuspend_user`
 * (`supabase/migrations/20261009150100_reports_and_moderation.sql`).
 *
 * `admin_suspend_user`/`admin_unsuspend_user` are the SECOND in-app writer of
 * `users.status`, alongside the self-service `soft_delete_own_account()` —
 * this is that writer's single TypeScript caller, asserted by
 * `no-second-write-path.test.ts`.
 *
 * The caller's own RLS-bound client, never the service role: every RPC here
 * re-checks `private.is_admin()` itself and fails closed for anyone who
 * isn't one — `admin_list_reports` returns `[]`, the three mutations raise
 * `42501`, identically for a non-admin and for an unknown id. This file adds
 * no authorization of its own; it exists to give the admin-only `/MapTest`
 * UI typed functions to call, not to decide who may call them.
 *
 * NOT WIRED INTO THE LIVE APP YET — see the amendment's §9.
 */

export interface ReportQueueRow {
  id: string;
  status: "open" | "actioned" | "dismissed";
  subjectKind: "user";
  category: string;
  details: string | null;
  evidenceSnapshot: Record<string, unknown> | null;
  slaDueAt: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  subject: { id: string; firstName: string | null; lastName: string | null; photoPath: string | null; status: string } | null;
  reporter: { id: string; firstName: string | null; lastName: string | null } | null;
}

export type ResolveReportRefusal = "already_resolved" | "no_enforcement_action";
export type SuspendUserRefusal = "invalid_target" | "not_found" | "not_active" | "report_mismatch";
export type UnsuspendUserRefusal = "not_found" | "not_suspended";

export class ModerationRefusedError extends Error {
  constructor(readonly reason: string) {
    super(`The moderation action was refused (${reason}).`);
    this.name = "ModerationRefusedError";
  }
}

/** The reports queue: open reports first (by SLA deadline), then closed ones. Empty for a non-admin. */
export async function adminListReports(supabase: SupabaseClient): Promise<ReportQueueRow[]> {
  const { data, error } = await supabase.rpc("admin_list_reports");

  if (error) {
    throw new Error(`Failed to list reports: ${error.message}`, { cause: error });
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    status: row.status as ReportQueueRow["status"],
    subjectKind: "user",
    category: String(row.category),
    details: typeof row.details === "string" ? row.details : null,
    evidenceSnapshot: (row.evidence_snapshot as Record<string, unknown> | null) ?? null,
    slaDueAt: String(row.sla_due_at),
    createdAt: String(row.created_at),
    resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : null,
    resolutionNote: typeof row.resolution_note === "string" ? row.resolution_note : null,
    subject: row.subject
      ? (() => {
          const s = row.subject as Record<string, unknown>;
          return {
            id: String(s.id),
            firstName: typeof s.first_name === "string" ? s.first_name : null,
            lastName: typeof s.last_name === "string" ? s.last_name : null,
            photoPath: typeof s.photo_path === "string" ? s.photo_path : null,
            status: String(s.status),
          };
        })()
      : null,
    reporter: row.reporter
      ? (() => {
          const r = row.reporter as Record<string, unknown>;
          return {
            id: String(r.id),
            firstName: typeof r.first_name === "string" ? r.first_name : null,
            lastName: typeof r.last_name === "string" ? r.last_name : null,
          };
        })()
      : null,
  }));
}

/** Closes an open report as dismissed, or as actioned (only while a suspend already exists for its subject). */
export async function adminResolveReport(
  supabase: SupabaseClient,
  reportId: string,
  decision: "actioned" | "dismissed",
  note?: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("admin_resolve_report", {
    p_report_id: reportId,
    p_decision: decision,
    p_note: note ?? null,
  });

  if (error) {
    throw new Error(`Failed to resolve the report: ${error.message}`, { cause: error });
  }

  const result = (data ?? null) as Record<string, unknown> | null;
  if (result === null || typeof result.ok !== "boolean") {
    throw new Error("admin_resolve_report returned an answer this app does not recognise.");
  }
  if (!result.ok) {
    throw new ModerationRefusedError(
      typeof result.reason === "string" ? result.reason : "unknown",
    );
  }
}

/** Suspends an active account (active -> suspended only), optionally closing an open report about them. */
export async function adminSuspendUser(
  supabase: SupabaseClient,
  targetUserId: string,
  reportId?: string,
  note?: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("admin_suspend_user", {
    p_target_user_id: targetUserId,
    p_report_id: reportId ?? null,
    p_note: note ?? null,
  });

  if (error) {
    throw new Error(`Failed to suspend the account: ${error.message}`, { cause: error });
  }

  const result = (data ?? null) as Record<string, unknown> | null;
  if (result === null || typeof result.ok !== "boolean") {
    throw new Error("admin_suspend_user returned an answer this app does not recognise.");
  }
  if (!result.ok) {
    throw new ModerationRefusedError(
      typeof result.reason === "string" ? result.reason : "unknown",
    );
  }
}

/** Lifts a suspension (suspended -> active only). */
export async function adminUnsuspendUser(
  supabase: SupabaseClient,
  targetUserId: string,
  note?: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("admin_unsuspend_user", {
    p_target_user_id: targetUserId,
    p_note: note ?? null,
  });

  if (error) {
    throw new Error(`Failed to unsuspend the account: ${error.message}`, { cause: error });
  }

  const result = (data ?? null) as Record<string, unknown> | null;
  if (result === null || typeof result.ok !== "boolean") {
    throw new Error("admin_unsuspend_user returned an answer this app does not recognise.");
  }
  if (!result.ok) {
    throw new ModerationRefusedError(
      typeof result.reason === "string" ? result.reason : "unknown",
    );
  }
}
