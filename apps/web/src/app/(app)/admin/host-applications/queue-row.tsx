"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import type { AdminHostApplication } from "@smartcard/types";
import { LocalTimestamp } from "@/components/local-timestamp";

import { AvatarDisc } from "../../connections/lib/avatar-disc";
import { displayName, initialsFor } from "../../events/lib/format";
import { GLASS } from "../../events/lib/surfaces";
import { decideHostApplicationAction } from "./actions";
import { initialDecideHostApplicationActionState } from "./action-state";

/**
 * One application in the admin review queue — §9.3's four fields plus the
 * applicant's name and photo (from `admin_list_host_applications`'s join),
 * with Approve and a two-step Reject.
 *
 * WHY REJECT IS TWO STEPS AND APPROVE IS ONE
 *
 * §9.3: approving needs no note; a rejection's note, when present, is what the
 * applicant reads verbatim ("write it as a sentence a person can act on").
 * Collapsing rejection into a single click would mean either always skipping
 * the note (losing a real, cheap kindness this design explicitly wants) or
 * prompting with `window.prompt` for text an admin is trusting the product to
 * hand a stranger. A small inline field, shown only after "Reject" is clicked
 * once, keeps the common case (approve) to one click while making the note an
 * actual compose step rather than an afterthought.
 */
export function QueueRow({
  application,
  photoUrl,
}: {
  application: AdminHostApplication;
  /**
   * Signed by the page via the caller's own RLS-bound client — see
   * `20260830130000_storage_admin_read_applicant_photos.sql` for the storage
   * policy that makes this succeed for an admin reading an applicant's path,
   * and `photo-url.ts` for why signing always goes through that client rather
   * than the service role. `null` for no photo, or if signing failed.
   */
  photoUrl: string | null;
}) {
  const [state, formAction] = useActionState(
    decideHostApplicationAction,
    initialDecideHostApplicationActionState,
  );
  const [rejecting, setRejecting] = useState(false);

  const name = displayName(application);

  return (
    <li className="flex flex-col gap-3 rounded-[22px] p-[17px]" style={GLASS}>
      <div className="flex items-start gap-3">
        <AvatarDisc size={36} fontSize={13} initials={initialsFor(application)} photoUrl={photoUrl} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[14px] leading-[19px] font-semibold">{name}</span>
          <span className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
            Applied <LocalTimestamp iso={application.submitted_at} />
          </span>
        </div>
      </div>

      <dl className="flex flex-col gap-1.5 text-[13px] leading-[18px]">
        <Row label="Organization" value={application.organization_name} />
        <Row label="Role" value={application.applicant_role} />
        <Row label="Past event" value={application.past_event_link} isLink />
        {application.expected_event_size !== null ? (
          <Row label="Expected size" value={application.expected_event_size} />
        ) : null}
        {application.hosting_frequency !== null ? (
          <Row label="Frequency" value={application.hosting_frequency} />
        ) : null}
      </dl>

      {state.error !== undefined ? (
        <p className="text-[13px] leading-[18px]" style={{ color: "#dc2626" }} role="alert">
          {state.error}
        </p>
      ) : null}

      {rejecting ? (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="applicationId" value={application.id} />
          <input type="hidden" name="decision" value="reject" />
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] leading-[17px] font-medium">
              Note to the applicant (optional) — written for them to read
            </span>
            <textarea
              name="rejectionNote"
              rows={2}
              maxLength={1000}
              placeholder="e.g. We couldn't verify a past event — feel free to reapply with a link."
              className="rounded-2xl border px-4 py-2.5 text-[13px] leading-[18px] outline-none"
              style={{ borderColor: "rgba(13,18,32,.12)", background: "rgba(255,255,255,.7)" }}
            />
          </label>
          <div className="flex gap-2">
            <SubmitButton label="Confirm rejection" tone="danger" />
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="min-h-11 rounded-full px-4 text-[13px] leading-[17px] font-semibold"
              style={{ background: "rgba(13,18,32,.06)", color: "var(--sc-text)" }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <form action={formAction}>
            <input type="hidden" name="applicationId" value={application.id} />
            <input type="hidden" name="decision" value="approve" />
            <SubmitButton label="Approve" tone="accent" />
          </form>
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className="min-h-11 rounded-full px-4 text-[13px] leading-[17px] font-semibold"
            style={{ background: "rgba(13,18,32,.06)", color: "var(--sc-text)" }}
          >
            Reject
          </button>
        </div>
      )}
    </li>
  );
}

function SubmitButton({ label, tone }: { label: string; tone: "accent" | "danger" }) {
  // `useFormStatus` reads the nearest enclosing <form>, so this has to be a
  // separate component rendered INSIDE each form — reading it in `QueueRow`
  // itself would read whichever form last submitted, not necessarily this row's.
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 rounded-full px-4 text-[13px] leading-[17px] font-semibold text-white disabled:opacity-60"
      style={{ background: tone === "accent" ? "var(--sc-accent)" : "#dc2626" }}
    >
      {pending ? "Working…" : label}
    </button>
  );
}

function Row({ label, value, isLink }: { label: string; value: string; isLink?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 font-medium" style={{ color: "var(--sc-text-muted)" }}>
        {label}
      </dt>
      <dd className="min-w-0 truncate">
        {isLink === true ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
