"use client";

import { useActionState } from "react";

import { updateRosterVisibilityAction } from "./actions";
import { initialActionState, type ActionState } from "./action-state";

/**
 * The event-roster visibility switch — `EmailOptInToggle`'s own shape,
 * copied exactly, for a different column
 * (`docs/architecture/2026-08-27-event-attendee-roster.md`,
 * 20260904100000).
 *
 * `roster_visibility` is nullable/tri-state at the database layer (null =
 * never chosen, which reads identically to `'hidden'` everywhere it is
 * gated), but this control only ever writes the two real values — there is
 * no third position to show, so `optIn` collapses null and `'hidden'` into
 * the same "Off". See `updateRosterVisibilityAction` for why the timestamp
 * is never a value this component or its action reads from the client.
 */
export function RosterVisibilityToggle({
  visible,
  labelledBy,
}: {
  /** The stored value, `roster_visibility === 'visible'`. Rendered as-is; never second-guessed locally. */
  visible: boolean;
  /** Id of the term this switch belongs to, so it is not announced as a bare "On". */
  labelledBy: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateRosterVisibilityAction.bind(null, !visible),
    initialActionState,
  );

  return (
    <form action={formAction} className="flex flex-col items-end">
      <button
        type="submit"
        role="switch"
        aria-checked={visible}
        aria-labelledby={labelledBy}
        disabled={pending}
        className="flex min-h-11 items-center gap-2 rounded-full pl-2 disabled:opacity-70"
      >
        <span className="text-[12px] leading-[17px] font-medium">
          {pending ? "Saving…" : visible ? "On" : "Off"}
        </span>
        <span
          aria-hidden
          className="relative block h-6 w-10 shrink-0 rounded-full transition-colors duration-200"
          style={{ background: visible ? "var(--sc-accent)" : "rgba(13,18,32,.14)" }}
        >
          <span
            className="absolute top-[3px] block size-[18px] rounded-full bg-white transition-[left] duration-200"
            style={{ left: visible ? 19 : 3 }}
          />
        </span>
      </button>

      {state.error === undefined ? null : (
        <p
          role="alert"
          className="max-w-[30ch] pb-1.5 text-right text-[11.5px] leading-4"
          style={{ color: "var(--sc-danger)", textWrap: "pretty" }}
        >
          {state.error}
        </p>
      )}
    </form>
  );
}
