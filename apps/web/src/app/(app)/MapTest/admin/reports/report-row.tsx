"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import type { ReportQueueRow } from "@/server/safety/moderation-service";

import { GLASS } from "../../../events/lib/surfaces";
import { dismissReportAction, suspendFromReportAction } from "./actions";
import { initialReportQueueActionState } from "./action-state";

/**
 * One row in the reports queue — dismiss, or suspend (which also marks this
 * report, and only this report, actioned). "Actioned" never exists as a bare
 * label without a real suspension behind it — see `admin_resolve_report`'s
 * own comment — so there is no separate "actioned" button here.
 */
export function ReportRow({ report }: { report: ReportQueueRow }) {
  const [dismissState, dismissAction] = useActionState(
    dismissReportAction,
    initialReportQueueActionState,
  );
  const [suspendState, suspendAction] = useActionState(
    suspendFromReportAction,
    initialReportQueueActionState,
  );
  const [note, setNote] = useState("");

  const closed = report.status !== "open";

  return (
    <li className="flex flex-col gap-2 rounded-[22px] p-[17px]" style={GLASS}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-[14px] leading-[19px] font-semibold">{report.category}</span>
          <span className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
            Subject: {report.subject?.firstName ?? "unknown"} · Reporter:{" "}
            {report.reporter?.firstName ?? "unknown"} · SLA due{" "}
            {new Date(report.slaDueAt).toLocaleString()}
          </span>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{
            background: closed ? "rgba(13,18,32,.06)" : "rgba(220,38,38,.08)",
            color: closed ? "var(--sc-text-muted)" : "#dc2626",
          }}
        >
          {report.status}
        </span>
      </div>

      {report.details !== null ? (
        <p className="text-[13px] leading-[18px]" style={{ color: "var(--sc-text-muted)" }}>
          {report.details}
        </p>
      ) : null}

      {report.subject?.status === "suspended" ? (
        <p className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-muted)" }}>
          Subject is currently suspended.
        </p>
      ) : null}

      {!closed ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] leading-[16px] font-medium">Note (optional)</span>
            <textarea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="rounded-2xl border px-3 py-2 text-[13px] leading-[18px] outline-none"
              style={{ borderColor: "rgba(13,18,32,.12)", background: "rgba(255,255,255,.7)" }}
            />
          </label>

          {dismissState.error !== undefined ? (
            <p className="text-[12px] leading-[17px]" style={{ color: "#dc2626" }}>
              {dismissState.error}
            </p>
          ) : null}
          {suspendState.error !== undefined ? (
            <p className="text-[12px] leading-[17px]" style={{ color: "#dc2626" }}>
              {suspendState.error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <form action={suspendAction}>
              <input type="hidden" name="reportId" value={report.id} />
              <input type="hidden" name="targetUserId" value={report.subject?.id ?? ""} />
              <input type="hidden" name="note" value={note} />
              <SubmitButton label="Suspend account" tone="danger" disabled={report.subject === null} />
            </form>
            <form action={dismissAction}>
              <input type="hidden" name="reportId" value={report.id} />
              <input type="hidden" name="note" value={note} />
              <SubmitButton label="Dismiss" tone="neutral" />
            </form>
          </div>
        </>
      ) : null}
    </li>
  );
}

function SubmitButton({
  label,
  tone,
  disabled,
}: {
  label: string;
  tone: "danger" | "neutral";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="min-h-11 rounded-full px-4 text-[13px] leading-[17px] font-semibold disabled:opacity-60"
      style={
        tone === "danger"
          ? { background: "var(--sc-danger)", color: "white" }
          : { background: "rgba(13,18,32,.06)", color: "var(--sc-text)" }
      }
    >
      {pending ? "Working…" : label}
    </button>
  );
}
