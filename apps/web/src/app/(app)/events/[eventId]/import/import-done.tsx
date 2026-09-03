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
 * `matched_existing_accounts` (20260903140000) is the same shape of
 * disclosure for the same reason — a count, never a list of who.
 *
 * STILL NO "WHO WAS IMPORTED" LINK, AND THE LINKS SCREEN IS NOT ONE. The
 * "Send claim links" button below goes to a list of guests who have NOT
 * claimed, holding a name, an email and a link and nothing else — see that
 * route's own header, and §11.5 of the design doc, for why that one read path
 * exists and what it deliberately still refuses to answer. A host cannot learn
 * from it which of their guests hold SmartCard accounts, which is the question
 * §3.9 keeps this screen's numbers aggregate to avoid.
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
          {summary.matched_existing_accounts > 0 ? (
            <Row
              label="Already had an account"
              value={summary.matched_existing_accounts}
              hint="Recorded as attending automatically — no link to send them."
            />
          ) : null}
        </dl>
      </div>

      <p
        className="max-w-[54ch] text-[13px] leading-[19px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        Guests may get an emailed claim link automatically; the links on the next screen are also
        there for you to send yourself, for anyone who doesn&rsquo;t. Nobody has been connected to
        anybody: importing records that someone attended, and connections still only happen in
        person.
      </p>

      <div className="flex flex-wrap gap-2 pb-2">
        {/*
          The primary action AFTER an import is now sending the links, not
          leaving — an import that nobody is told about does nothing at all
          until the email phase (§5) exists. This link is why the copy above
          could stop saying "that's a separate step still being built" and say
          where the links actually are instead: §7's rule cuts both ways, and
          naming a capability that DOES exist is the other half of it.
        */}
        <Link
          href={`/events/${eventId}/import/links`}
          className="flex min-h-11 items-center rounded-full px-[18px] text-[13px] leading-[17px] font-semibold"
          style={PRIMARY_BUTTON}
        >
          Send claim links
        </Link>
        <Link
          href={`/events/${eventId}`}
          className="flex min-h-11 items-center rounded-full px-[18px] text-[13px] leading-[17px] font-semibold"
          style={SECONDARY_BUTTON}
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
