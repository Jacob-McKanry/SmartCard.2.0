import { notFound, redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { isAdmin } from "@/server/hosting/host-application-service";
import { adminListReports } from "@/server/safety/moderation-service";

import { GLASS } from "../../../events/lib/surfaces";
import { ReportRow } from "./report-row";

/**
 * The reports queue (owner decision 4 & 14,
 * `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`). See
 * `/MapTest/page.tsx`'s header — admin-only, not wired into the real nav yet.
 *
 * `admin_list_reports` returns `[]` to a non-admin — the real enforcement,
 * re-derived from the JWT. The `isAdmin` check here only decides routing,
 * the same two-gate shape `/admin/host-applications` uses.
 */
export const dynamic = "force-dynamic";

export default async function AdminReportsQueuePage() {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }

  if (!(await isAdmin(context.supabase))) {
    notFound();
  }

  const reports = await adminListReports(context.supabase);
  const open = reports.filter((r) => r.status === "open");
  const closed = reports.filter((r) => r.status !== "open");

  return (
    <main
      className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-[22px] pt-4 pb-6 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[27px] leading-[31px] font-semibold tracking-[-0.03em]">
          Reports queue
        </h1>
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-subtle)" }}>
          {open.length} open, sorted by SLA deadline
        </p>
      </header>

      {reports.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-[26px] p-[17px]" style={GLASS}>
          <h2 className="text-[15px] leading-5 font-semibold">Nothing to review</h2>
          <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
            New reports will show up here, sorted by their 24h SLA deadline.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {[...open, ...closed].map((report) => (
            <ReportRow key={report.id} report={report} />
          ))}
        </ul>
      )}
    </main>
  );
}
