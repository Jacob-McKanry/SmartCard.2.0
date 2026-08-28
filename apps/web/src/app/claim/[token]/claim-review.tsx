"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import type { AttendeeImportClaimPrefill } from "@smartcard/types";

import { GLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./surfaces";
import { claimEventImportAction } from "./actions";
import { initialClaimActionState } from "./action-state";

/**
 * §4.2 step 4 — "every field the CSV offered, each individually keepable or
 * discardable" — plus step 5, landing on the event once the claim succeeds.
 *
 * ONLY REACHED WHEN `can_claim: true`. The gate that got the caller here
 * (§3.2/§3.2.1) is re-derived from scratch inside `claim_event_import`
 * itself, not trusted from the read that produced `prefill` — see
 * `claim-service.ts` and 20260828130000's header. This component has nothing
 * to enforce; it only has to render the choice honestly and send it.
 *
 * EVERY CHECKBOX DEFAULTS TO CHECKED, UNLIKE THE HOST'S ATTESTATION CHECKBOX
 *
 * `review-and-attest.tsx`'s attestation cannot start ticked because it is a
 * legal claim of authority over other people's contacts — a person ticking
 * FOR themselves. These checkboxes are the opposite kind of choice: keeping
 * or discarding the caller's OWN prefilled data, matching §4.2's own
 * language, "filled in but nothing shared beyond what the normal profile
 * defaults share" — the sharing question is a separate, existing profile
 * visibility setting this screen does not touch. A field with no value in
 * the CSV renders no checkbox at all; there is nothing to keep or discard.
 *
 * COPY, PER §2.3.1's PASS: NEVER "YOU ATTENDED"
 *
 * This system has no check-in signal from any CSV a host has ever uploaded —
 * only "the host says this person was on the list" (§2.3.1). Every sentence
 * on this screen and its sibling (`claim-teaser.tsx`) says "guest list" or
 * "says you were there", never "attended".
 */
export function ClaimReview({
  lookupToken,
  eventId,
  eventName,
  hostFirstName,
  hostLastName,
  prefill,
}: {
  lookupToken: string;
  eventId: string;
  eventName: string;
  hostFirstName: string | null;
  hostLastName: string | null;
  prefill: AttendeeImportClaimPrefill;
}) {
  const [state, formAction, pending] = useActionState(
    (prev: typeof initialClaimActionState, formData: FormData) =>
      claimEventImportAction(lookupToken, prev, formData),
    initialClaimActionState,
  );

  if (state.claimed === true) {
    return <ClaimDone eventId={eventId} eventName={eventName} />;
  }

  const hostName = [hostFirstName, hostLastName].filter(Boolean).join(" ").trim();
  const fullName = [prefill.first_name, prefill.last_name].filter(Boolean).join(" ").trim();

  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-col gap-4 px-5 py-10">
      <header className="flex flex-col gap-1.5 text-center">
        <h1 className="text-[24px] leading-[28px] font-semibold" style={{ letterSpacing: "-.03em" }}>
          {eventName}
        </h1>
        <p className="text-[14px] leading-5" style={{ color: "var(--sc-text-muted)" }}>
          {hostName !== "" ? `${hostName} says you were on the guest list.` : "You were on the guest list."}
        </p>
      </header>

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-[26px] p-[17px]" style={GLASS}>
          <h2 className="text-[13px] leading-[17px] font-semibold">Choose what to keep</h2>
          <p
            className="text-[12px] leading-[17px]"
            style={{ color: "var(--sc-text-subtle)", textWrap: "pretty" }}
          >
            This is what {hostName !== "" ? hostName : "the host"} included for you. Anything you
            already have on your profile is left alone — this only fills in what&rsquo;s blank.
          </p>

          <FieldCheckbox
            name="first_name"
            label="First name"
            value={prefill.first_name}
          />
          <FieldCheckbox name="last_name" label="Last name" value={prefill.last_name} />
          <FieldCheckbox name="phone_number" label="Phone number" value={prefill.phone_number} />
          <FieldCheckbox name="company_name" label="Company" value={prefill.company_name} />
          <FieldCheckbox name="company_role" label="Role" value={prefill.company_role} />

          {prefill.social_links.length > 0 ? (
            <label className="flex cursor-pointer items-start gap-2.5 border-t pt-3" style={{ borderTopColor: "rgba(13,18,32,.1)" }}>
              <input
                type="checkbox"
                name="social_links"
                defaultChecked
                className="mt-[3px] size-[18px] shrink-0 accent-[var(--sc-accent)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] leading-[18px] font-medium">
                  Social links ({prefill.social_links.length})
                </span>
                <span className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
                  {prefill.social_links.map((link) => link.url).join(" · ")}
                </span>
              </span>
            </label>
          ) : null}

          {fullName === "" && prefill.social_links.length === 0 ? (
            <p className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
              This guest list only had your email address — nothing else to fill in.
            </p>
          ) : null}
        </div>

        {state.error !== undefined ? (
          <p role="alert" className="text-[13px] leading-[19px]" style={{ color: "var(--sc-danger)" }}>
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="flex min-h-11 items-center justify-center gap-[7px] rounded-full px-[18px] text-[15px] leading-[19px] font-semibold disabled:opacity-50"
          style={PRIMARY_BUTTON}
        >
          {pending ? "Claiming…" : "Claim my profile"}
        </button>
      </form>

      <p
        className="max-w-[46ch] text-center text-[12px] leading-[17px]"
        style={{ color: "var(--sc-text-subtle)", textWrap: "pretty" }}
      >
        Nobody is connected to anybody by this. Connections on SmartCard only ever happen through an
        in-person NFC tap or QR scan.
      </p>
    </main>
  );
}

/**
 * Uncontrolled, like the social-links checkbox above: nothing above this
 * component ever needs to read a field's checked state before submit, so
 * there is no reason to lift it into React state.
 */
function FieldCheckbox({ name, label, value }: { name: string; label: string; value: string | null }) {
  if (value === null || value.trim() === "") return null;

  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        name={name}
        defaultChecked
        className="mt-[3px] size-[18px] shrink-0 accent-[var(--sc-accent)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] leading-[18px] font-medium">{label}</span>
        <span className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
          {value}
        </span>
      </span>
    </label>
  );
}

/**
 * §4.2 step 5, "land on the event" — a link rather than an automatic
 * redirect, the same choice `ImportDone` makes for the host side: this
 * screen is also the one confirmation that the claim actually went through,
 * and navigating away from it instantly would remove that confirmation
 * before anyone could read it.
 */
function ClaimDone({ eventId, eventName }: { eventId: string; eventName: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col items-center justify-center gap-4 px-6 text-center">
      <span
        className="flex size-[44px] shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--sc-accent)", color: "#fff" }}
      >
        <Check size={22} strokeWidth={2.6} aria-hidden />
      </span>
      <h1 className="text-[22px] leading-[26px] font-semibold" style={{ letterSpacing: "-.02em" }}>
        You&rsquo;re on the list
      </h1>
      <p
        className="max-w-[34ch] text-[14px] leading-[20px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        Your profile for {eventName} is ready. You can keep editing it any time from your own
        profile.
      </p>
      <Link
        href={`/events/${eventId}`}
        className="mt-1 flex min-h-11 items-center justify-center rounded-full px-5 text-[15px] font-semibold"
        style={SECONDARY_BUTTON}
      >
        Go to the event
      </Link>
    </main>
  );
}
