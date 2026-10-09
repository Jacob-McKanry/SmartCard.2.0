"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { containsBlockedTerm, type BlockedTerm } from "@smartcard/core";

import { GLASS } from "@/app/(app)/events/lib/surfaces";

import { initialReportActionState, submitReportAction } from "./safety-actions";
import { REPORT_CATEGORIES, type ReportCategory } from "@/server/safety/reports-service";

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  harassment: "Harassment",
  inappropriate_content: "Inappropriate content",
  spam: "Spam",
  safety_concern: "Safety concern",
  underage: "I think they're under 18",
  impersonation: "Impersonation",
  other: "Something else",
};

/**
 * The shared report sheet (owner decision 4,
 * `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`). Takes
 * only `targetUserId` and nothing app-specific, so a later phase can drop it
 * onto a real page with no rework.
 *
 * The inline "this may be rejected" hint is a CLIENT-SIDE HINT ONLY — see
 * `containsBlockedTerm`'s own header. It never blocks submission; the server
 * (`private.text_violation`) is what actually decides, and `details_rejected`
 * is the error state this form shows when it does. `blockedTerms` is
 * optional and defaults to showing no hint, since the term list
 * (`list_blocked_terms`) isn't wired into every caller of this component yet.
 */
export function ReportSheet({
  targetUserId,
  targetLabel,
  blockedTerms = [],
  onClose,
}: {
  targetUserId: string;
  targetLabel: string;
  blockedTerms?: readonly BlockedTerm[];
  onClose: () => void;
}) {
  const [state, formAction] = useActionState(submitReportAction, initialReportActionState);
  const [details, setDetails] = useState("");

  if (state.done === true) {
    return (
      <div className="flex flex-col gap-3 rounded-[26px] p-[17px]" style={GLASS}>
        <h2 className="text-[15px] leading-5 font-semibold">Report received</h2>
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
          We&apos;ll review it within 24 hours. Thank you for flagging it.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 self-start rounded-full px-4 text-[13px] leading-[17px] font-semibold"
          style={{ background: "rgba(13,18,32,.06)", color: "var(--sc-text)" }}
        >
          Close
        </button>
      </div>
    );
  }

  const likelyFlagged = blockedTerms.length > 0 && containsBlockedTerm(details, blockedTerms);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-[26px] p-[17px]" style={GLASS}>
      <input type="hidden" name="targetUserId" value={targetUserId} />

      <h2 className="text-[15px] leading-5 font-semibold">Report {targetLabel}</h2>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[12px] leading-[17px] font-medium">What&apos;s going on?</legend>
        {REPORT_CATEGORIES.map((category) => (
          <label key={category} className="flex items-center gap-2 text-[13px] leading-[18px]">
            <input type="radio" name="category" value={category} required />
            {CATEGORY_LABELS[category]}
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] leading-[17px] font-medium">
          Details (optional) — describe what happened rather than quoting it
        </span>
        <textarea
          name="details"
          rows={3}
          maxLength={1000}
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          className="rounded-2xl border px-4 py-2.5 text-[13px] leading-[18px] outline-none"
          style={{ borderColor: "rgba(13,18,32,.12)", background: "rgba(255,255,255,.7)" }}
        />
        {likelyFlagged ? (
          <span className="text-[12px] leading-[16px]" style={{ color: "#dc2626" }}>
            This may be rejected — try describing what happened instead of quoting it.
          </span>
        ) : null}
      </label>

      {state.error !== undefined ? (
        <p className="text-[13px] leading-[18px]" style={{ color: "#dc2626" }} role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <SubmitButton />
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-full px-4 text-[13px] leading-[17px] font-semibold"
          style={{ background: "rgba(13,18,32,.06)", color: "var(--sc-text)" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-full px-4 text-[13px] leading-[17px] font-semibold text-white disabled:opacity-60"
      style={{ background: "var(--sc-danger)" }}
    >
      {pending ? "Sending…" : "Submit report"}
    </button>
  );
}
