"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import type { AttendeeImportSummary } from "@smartcard/types";

import { GLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../../lib/surfaces";

/**
 * Step 4 of 4 — what the database actually did.
 *
 * FOUR NUMBERS, NOT ONE TICK, AND THE SPLIT IS THE USEFUL PART
 *
 * A host who uploads a corrected file and sees only "done" has no way to tell
 * whether the correction landed. `imported` versus `updated` answers exactly
 * that: a re-upload of the same list reads as "0 added, 142 updated", which is
 * both reassuring and true. The import is an UPSERT on `(event_id, email)`, so
 * re-uploading is a supported thing to do rather than a mistake to warn about.
 *
 * `skipped_already_claimed` IS A COUNT AND MUST STAY ONE. Naming those people
 * would tell the host which of their guests hold SmartCard accounts — a fact
 * about those people, not about the host's own file, and not one they gave the
 * host. The copy below says what the number means without offering a list.
 *
 * NO "WHO WAS IMPORTED" LINK. There is no read path to `event_attendee_imports`
 * anywhere in this app and this screen does not invent one. The host already
 * holds the CSV they uploaded; a second copy of other people's contact details
 * behind a second set of checks would be a liability with no purpose.
 */
export function ImportDone({
  eventId,
  summary,
  onImportAnother,
}: {
  eventId: string;
  summary: AttendeeImportSummary;
  onImportAnother: () => void;
}) {
  const touched = summary.imported + summary.updated;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-[26px] p-[17px]" style={GLASS}>
        <div className="flex items-center gap-2.5">
          <span
            className="flex size-[30px] shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--sc-accent)", color: "#fff" }}
          >
            <Check size={17} strokeWidth={2.6} aria-hidden />
          </span>
          <h2 className="text-[17px] leading-[22px] font-semibold tracking-[-0.01em]">
            {touched === 0
              ? "Nothing changed"
              : `${touched} ${touched === 1 ? "guest" : "guests"} on the list`}
          </h2>
        </div>

        <dl className="flex flex-col gap-1.5">
          <Row label="Added" value={summary.imported} />
          <Row
            label="Updated"
            value={summary.updated}
            hint="Already on the list from an earlier upload; their details were refreshed."
          />
          {summary.skipped_no_email > 0 ? (
            <Row
              label="Skipped, no email"
              value={summary.skipped_no_email}
              hint="No address means no way for them to ever claim the profile."
            />
          ) : null}
          {summary.skipped_already_claimed > 0 ? (
            <Row
              label="Left alone"
              value={summary.skipped_already_claimed}
              hint="Already claimed their profile, so it's theirs to edit now, not yours to overwrite."
            />
          ) : null}
        </dl>
      </div>

      <p
        className="max-w-[54ch] text-[13px] leading-[19px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        Nobody has been emailed yet — that&rsquo;s a separate step still being built. Nobody has
        been connected to anybody either: importing records that someone attended, and connections
        still only happen in person.
      </p>

      <div className="flex flex-wrap gap-2 pb-2">
        <Link
          href={`/events/${eventId}`}
          className="flex min-h-11 items-center rounded-full px-[18px] text-[13px] leading-[17px] font-semibold"
          style={PRIMARY_BUTTON}
        >
          Back to the event
        </Link>
        <button
          type="button"
          onClick={onImportAnother}
          className="min-h-11 rounded-full px-[18px] text-[13px] leading-[17px] font-semibold"
          style={SECONDARY_BUTTON}
        >
          Import another file
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-[13px] leading-[18px] font-medium">{label}</dt>
        <dd className="text-[15px] leading-5 font-semibold tabular-nums">{value}</dd>
      </div>
      {hint === undefined ? null : (
        <p
          className="max-w-[46ch] text-[12px] leading-[17px]"
          style={{ color: "var(--sc-text-subtle)", textWrap: "pretty" }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
