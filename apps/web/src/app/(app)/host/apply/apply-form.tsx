"use client";

import { useActionState } from "react";
import { CircleAlert } from "lucide-react";

import { GLASS, PRIMARY_BUTTON } from "../../events/lib/surfaces";
import { submitHostApplicationAction } from "./actions";
import { initialHostApplicationActionState } from "./action-state";

/**
 * The four fields §9.2 asks for, and only those — see that section's own
 * reasoning for why government ID and business registration are deliberately
 * NOT here: "anything that would make this form a bigger data-collection
 * liability than the abuse it prevents."
 *
 * `rejectionNote` and `defaultValues` let a rejected applicant re-apply
 * without retyping everything, and see why they were turned down without
 * that note surviving into the resubmitted application (it's read-only
 * context here, never written back — `submit_host_application` clears it on
 * any new submission regardless of what this form sends).
 */
export function ApplyForm({
  rejectionNote,
  defaultValues,
}: {
  rejectionNote?: string | null;
  defaultValues?: {
    organizationName: string;
    applicantRole: string;
    pastEventLink: string;
    expectedEventSize: string | null;
    hostingFrequency: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState(
    submitHostApplicationAction,
    initialHostApplicationActionState,
  );

  if (state.success === true) {
    return (
      <div className="flex flex-col gap-2 rounded-[26px] p-[17px]" style={GLASS}>
        <h2 className="text-[15px] leading-5 font-semibold">Application sent</h2>
        <p
          className="max-w-[54ch] text-[13px] leading-[19px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          We&rsquo;ll look it over and let you know. You can come back to this page any time to
          check where things stand.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {rejectionNote !== undefined && rejectionNote !== null && rejectionNote !== "" ? (
        <div
          className="flex items-start gap-2.5 rounded-[20px] p-[15px] text-[13px] leading-[19px]"
          style={{ background: "rgba(220,38,38,.08)", color: "var(--sc-text)" }}
        >
          <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">Your last application wasn&rsquo;t approved:</strong>{" "}
            {rejectionNote}
          </span>
        </div>
      ) : null}

      <Field
        label="Organization name"
        name="organizationName"
        required
        defaultValue={defaultValues?.organizationName}
      />
      <Field
        label="Your role there"
        name="applicantRole"
        required
        defaultValue={defaultValues?.applicantRole}
      />
      <Field
        label="Link to a past event"
        name="pastEventLink"
        required
        placeholder="A Luma, Eventbrite or Partiful page, or a social post"
        defaultValue={defaultValues?.pastEventLink}
      />
      <Field
        label="Expected event size"
        name="expectedEventSize"
        placeholder="e.g. 40-60 people"
        defaultValue={defaultValues?.expectedEventSize ?? undefined}
      />
      <Field
        label="Hosting frequency"
        name="hostingFrequency"
        placeholder="e.g. monthly, one-off"
        defaultValue={defaultValues?.hostingFrequency ?? undefined}
      />

      {state.error !== undefined ? (
        <p className="text-[13px] leading-[18px]" style={{ color: "#dc2626" }} role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="flex min-h-11 items-center justify-center rounded-full px-[18px] text-[13px] leading-[17px] font-semibold disabled:opacity-60"
        style={PRIMARY_BUTTON}
      >
        {pending ? "Sending…" : "Submit application"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] leading-[18px] font-medium">
        {label}
        {required === true ? null : (
          <span style={{ color: "var(--sc-text-subtle)" }}> (optional)</span>
        )}
      </span>
      <input
        name={name}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        maxLength={500}
        className="min-h-11 rounded-2xl border px-4 text-[14px] leading-[19px] outline-none"
        style={{ borderColor: "rgba(13,18,32,.12)", background: "rgba(255,255,255,.7)" }}
      />
    </label>
  );
}
