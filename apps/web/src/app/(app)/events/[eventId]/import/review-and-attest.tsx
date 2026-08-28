"use client";

import { useActionState, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import type { NormalizeResult } from "@smartcard/core";

import { GLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../../lib/surfaces";
import { importAttendeesAction } from "./actions";
import { initialAttendeeImportActionState, type AttendeeImportActionState } from "./action-state";

/**
 * Step 3 of 4 — the list as it will be imported, and the attestation.
 *
 * THIS SCREEN IS THE FEATURE'S LAWFUL BASIS, NOT A CONFIRMATION STEP
 *
 * Everything below this point writes contact details for people who have never
 * heard of SmartCard and never agreed to us holding anything. The only thing
 * that makes that defensible is a host looking at the actual list and saying
 * they may contact these people about this event — which is why the rows shown
 * here are the rows that get sent (§11.2), and why `attested_at` is NOT NULL in
 * the database so no code path can write a row without it.
 *
 * The checkbox is unticked on arrival and cannot be pre-ticked. It is also a
 * real form field rather than a value the client computes, so the assertion is
 * something a person did rather than something this component decided.
 *
 * WHAT THE PREVIEW SHOWS, AND WHY IT IS TRUNCATED
 *
 * Ten rows. Not for privacy — this is the host's own file, and they exported it
 * — but because a host cannot meaningfully review three thousand rows by
 * scrolling, and a wall of them invites the scroll-to-the-bottom-and-tick
 * behaviour this step exists to prevent. The counts above it are the part that
 * is genuinely reviewable: "142 guests, 3 with no email, 11 declined left out"
 * is a claim a host can check against what they remember of their own event.
 *
 * NO OPTIMISTIC UI. The four counts on the next screen come from the database's
 * own answer, because the split between "imported" and "updated" is not
 * knowable here — this component has no idea who was already in the table from
 * a previous upload, and guessing would tell a host they added 200 people when
 * they corrected 200.
 */

/** See the header: reviewable, not exhaustive. */
const PREVIEW_ROWS = 10;

export function ReviewAndAttest({
  eventId,
  fileName,
  result,
  onBack,
  onDone,
}: {
  eventId: string;
  fileName: string;
  result: NormalizeResult;
  onBack: () => void;
  onDone: (state: AttendeeImportActionState) => void;
}) {
  const [state, formAction, pending] = useActionState<AttendeeImportActionState, FormData>(
    async (prev, formData) => {
      const next = await importAttendeesAction(eventId, prev, formData);
      if (next.success === true) onDone(next);
      return next;
    },
    initialAttendeeImportActionState,
  );
  const [attested, setAttested] = useState(false);

  // Serialised once. This is the payload — the same array the counts and the
  // preview below describe, so there is nothing between what is shown and what
  // is sent. For a full-size import it is around a megabyte of hidden input,
  // comfortably inside the 6MB `serverActions.bodySizeLimit` already set in
  // `next.config.ts`.
  const rowsJson = useMemo(() => JSON.stringify(result.rows), [result.rows]);

  const skippedTotal = Object.values(result.skipped).reduce((a, b) => a + b, 0);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="rows" value={rowsJson} />

      <div className="flex flex-col gap-3 rounded-[26px] p-[17px]" style={GLASS}>
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] leading-5 font-semibold">
            {result.rows.length} {result.rows.length === 1 ? "guest" : "guests"} ready to import
          </h2>
          <p className="truncate text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
            from {fileName}
          </p>
        </div>

        {skippedTotal > 0 ? <SkippedBreakdown skipped={result.skipped} /> : null}
      </div>

      {result.rows.length > 0 ? (
        <div className="flex flex-col gap-2.5 rounded-[26px] p-[17px]" style={GLASS}>
          <h3 className="text-[13px] leading-[17px] font-semibold">
            {result.rows.length <= PREVIEW_ROWS
              ? "The whole list"
              : `The first ${PREVIEW_ROWS}, so you can check the columns landed right`}
          </h3>
          <ul className="flex flex-col gap-2">
            {result.rows.slice(0, PREVIEW_ROWS).map((row) => (
              <li key={row.email.toLowerCase()} className="flex flex-col">
                <span className="truncate text-[13px] leading-[18px] font-medium">
                  {[row.first_name, row.last_name].filter(Boolean).join(" ") || row.email}
                </span>
                <span
                  className="truncate text-[12px] leading-[17px]"
                  style={{ color: "var(--sc-text-subtle)" }}
                >
                  {[
                    row.email,
                    row.company_role,
                    row.company_name,
                    row.phone_number,
                    ...row.social_links.map((link) => link.url),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-[26px] p-[17px]" style={GLASS}>
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            name="attested"
            checked={attested}
            onChange={(event) => setAttested(event.target.checked)}
            className="mt-[3px] size-[18px] shrink-0 accent-[var(--sc-accent)]"
          />
          <span className="text-[13px] leading-[19px]" style={{ textWrap: "pretty" }}>
            These people attended <strong>this event</strong>, and I&rsquo;m allowed to contact them
            about it.
          </span>
        </label>
        <p
          className="max-w-[54ch] text-[12px] leading-[17px]"
          style={{ color: "var(--sc-text-subtle)", textWrap: "pretty" }}
        >
          We&rsquo;ll email each of them once, offering them the profile this fills in. They choose
          what to keep, what to change, and what to share — and nobody is connected to anybody by
          importing them.
        </p>
      </div>

      {state.error !== undefined ? (
        <p role="alert" className="text-[13px] leading-[19px]" style={{ color: "var(--sc-danger)" }}>
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pb-2">
        <button
          type="submit"
          disabled={!attested || pending || result.rows.length === 0}
          className="flex min-h-11 items-center gap-[7px] rounded-full px-[18px] text-[13px] leading-[17px] font-semibold disabled:opacity-50"
          style={PRIMARY_BUTTON}
        >
          <Upload size={15} strokeWidth={2.1} aria-hidden />
          {pending ? "Importing…" : `Import ${result.rows.length}`}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="min-h-11 rounded-full px-[18px] text-[13px] leading-[17px] font-semibold disabled:opacity-50"
          style={SECONDARY_BUTTON}
        >
          Back to columns
        </button>
      </div>
    </form>
  );
}

/**
 * Why the number on this screen is smaller than the number of rows in the file.
 *
 * Every one of these is a row the host will otherwise wonder about, and
 * `normaliseImportRows` guarantees each input row lands in exactly one bucket —
 * so this accounts for the whole difference rather than most of it.
 */
function SkippedBreakdown({ skipped }: { skipped: NormalizeResult["skipped"] }) {
  const lines: string[] = [];
  if (skipped.excludedStatus > 0) {
    lines.push(`${skipped.excludedStatus} declined or never answered`);
  }
  if (skipped.waitlistNotIncluded > 0) {
    lines.push(`${skipped.waitlistNotIncluded} waitlisted, which you chose to leave out`);
  }
  if (skipped.approvedNotIncluded > 0) {
    lines.push(`${skipped.approvedNotIncluded} attending, which you chose to leave out`);
  }
  if (skipped.duplicate > 0) {
    lines.push(`${skipped.duplicate} repeat rows merged into the guest above`);
  }
  if (skipped.noEmail > 0) {
    lines.push(`${skipped.noEmail} with no email address`);
  }

  return (
    <div className="flex flex-col gap-1 border-t pt-[11px]" style={{ borderTopColor: "rgba(13,18,32,.1)" }}>
      <p className="text-[12px] leading-[17px] font-medium">Not being imported</p>
      <ul className="flex flex-col gap-0.5">
        {lines.map((line) => (
          <li key={line} className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-muted)" }}>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
