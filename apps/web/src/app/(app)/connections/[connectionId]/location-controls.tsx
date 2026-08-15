"use client";

import { useActionState } from "react";
import type { LocationVisibility } from "@smartcard/types";

import { setLocationConsentAction, setLocationVisibilityAction, setMarkedPrivateAction } from "./actions";
import { initialActionState } from "./action-state";
import {
  locationSharingLabel,
  locationSharingLabelColor,
  locationSharingSummary,
  type LocationSharingStatus,
} from "./location-sharing";

/**
 * The three location-privacy controls the RLS grants in
 * `20260809211200_rls_policies_graph_and_meetings.sql` actually allow a
 * participant to touch — see the build report for the exact mapping. This
 * component renders all three every time; it never hides a control because
 * "the other setting makes it moot" — the whole point of this screen is
 * showing the real, composed state rather than a UI that can't tell the
 * difference between "not shared" and "shared, but a privacy flag is
 * blocking it anyway".
 *
 * ---------------------------------------------------------------------------
 * DESIGN PASS (`docs/design/DESIGN.md` §5 "Toggles", §6 "Meeting record").
 *
 * The three controls are now 40x24 toggles inside the record's glass panel,
 * with the derived state as a mono label above them, matching the prototype.
 * Three things about that port were constrained rather than chosen:
 *
 *  1. **Every toggle is still a `<form>` posting a Server Action.** It looks
 *     like a switch; it is a submit button. Nothing here writes optimistically
 *     or holds local state that could drift from the row — §7's "render stored
 *     state, not the tapped intent" applies literally: the knob position is
 *     always the value the last render read out of the database.
 *
 *  2. **The explanatory line under each toggle survived the redesign.** The
 *     prototype shows a bare label and a switch. Three of those labels carry
 *     rules a person cannot infer from the switch — that "visible to mutuals"
 *     is a *shared* setting either party can flip, that agreement is per-person
 *     and reversible, and that a private mark is a one-sided veto only its
 *     owner can lift. §8 puts rule-bearing text at 12px+ in `--sc-text-muted`,
 *     so that is what these are. Dropping them for a cleaner row would have
 *     been the design overselling what the copy is holding.
 *
 *  3. **Nothing displays the *other* person's consent as a toggle.** Their
 *     value is readable (the participants policy is symmetric) and is stated
 *     in words, but it is not rendered as a control — there is no write path
 *     for it, and a greyed-out switch would imply one exists.
 */
export function LocationControls({
  meetingId,
  connectionId,
  otherName,
  locationVisibility,
  viewerConsent,
  otherConsent,
  viewerMarkedPrivate,
  otherMarkedPrivate,
  sharingStatus,
}: {
  meetingId: string;
  connectionId: string;
  otherName: string;
  locationVisibility: LocationVisibility;
  viewerConsent: boolean;
  otherConsent: boolean;
  viewerMarkedPrivate: boolean;
  otherMarkedPrivate: boolean;
  sharingStatus: LocationSharingStatus;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] leading-[17px] font-semibold">Location sharing</span>
        <span
          className="shrink-0 font-mono text-[10px] leading-[14px] font-medium tracking-[0.1em]"
          style={{ color: locationSharingLabelColor(sharingStatus) }}
        >
          {locationSharingLabel(sharingStatus, otherName)}
        </span>
      </div>

      <p
        className="text-[12px] leading-[17px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        {locationSharingSummary(sharingStatus, otherName)}
      </p>

      <ToggleRow
        label="Visible to mutual connections"
        on={locationVisibility === "mutuals"}
        note={`A shared setting — either you or ${otherName} can turn it on or off at any time. On its own it shows nothing; you both still have to agree below.`}
        action={setLocationVisibilityAction.bind(
          null,
          meetingId,
          connectionId,
          locationVisibility === "mutuals" ? "participants_only" : "mutuals",
        )}
      />

      <ToggleRow
        label="You agree to share it"
        on={viewerConsent}
        note={
          otherConsent
            ? `${otherName} has agreed too. Either of you withdrawing is enough to stop it.`
            : `Waiting on ${otherName} to agree. You can't see their choice change until they make it.`
        }
        action={setLocationConsentAction.bind(null, meetingId, connectionId, !viewerConsent)}
      />

      <ToggleRow
        label="Mark this meeting private"
        on={viewerMarkedPrivate}
        note={
          otherMarkedPrivate
            ? `Your own override, on top of the two settings above. ${otherName} has separately marked this private too — that's their call, and you can't change it.`
            : `Your own override, on top of the two settings above. Once set, only you can lift it — ${otherName} has no way to reverse your choice.`
        }
        action={setMarkedPrivateAction.bind(null, meetingId, connectionId, !viewerMarkedPrivate)}
      />
    </div>
  );
}

/**
 * One 40x24 toggle (§5's spec) that is really a form submit.
 *
 * `aria-pressed` rather than a checkbox role: this is a button that performs
 * a write when pressed, not an input whose value is read on some later
 * submit, and describing it as the latter would let a screen reader user
 * believe they can flip it and change their mind before committing.
 */
function ToggleRow({
  label,
  note,
  on,
  action,
}: {
  label: string;
  note: string;
  on: boolean;
  action: (prevState: { error?: string; success?: boolean }) => Promise<{
    error?: string;
    success?: boolean;
  }>;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);

  return (
    <div className="flex flex-col gap-1">
      <form action={formAction}>
        <button
          type="submit"
          aria-pressed={on}
          disabled={pending}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-[12.5px] leading-[17px] font-medium disabled:opacity-60"
        >
          <span>{label}</span>
          <span
            aria-hidden
            className="relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200"
            style={{ background: on ? "var(--sc-accent)" : "rgba(13,18,32,.14)" }}
          >
            <span
              className="absolute top-[3px] size-[18px] rounded-full bg-white transition-[left] duration-300"
              style={{ left: on ? 19 : 3, transitionTimingFunction: "var(--sc-ease-spring)" }}
            />
          </span>
        </button>
      </form>
      <p
        className="max-w-[52ch] pr-[52px] text-[12px] leading-[17px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        {note}
      </p>
      {state.error ? (
        <p className="text-[12px] leading-[17px]" style={{ color: "var(--sc-danger)" }}>
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
