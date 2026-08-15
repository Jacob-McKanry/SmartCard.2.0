"use client";

import { useActionState } from "react";

import { updateEmailOptInAction } from "./actions";
import { initialActionState, type ActionState } from "./action-state";

/**
 * The "occasional emails" switch in Profile's contact sheet.
 *
 * WHAT IT WRITES, AND WHY THAT IS A ONE-LINE ANSWER
 *
 * `users.email_opt_in`, and nothing else. `updateEmailOptInAction` exists so
 * this control cannot do anything wider — see its header for why posting to the
 * whole-profile action would have blanked seven other columns.
 *
 * THE STATE IS WORDED, NOT ONLY COLOURED (§8)
 *
 * "On"/"Off" is the switch's own visible label, next to the pill. The pill's
 * accent fill and the knob's position say the same thing a second and third
 * time; none of them is the only signal. `role="switch"` with `aria-checked`
 * carries the same fact to assistive tech, and `aria-labelledby` points at the
 * "Occasional emails" term in the sheet so the control is not announced as a
 * bare "On".
 *
 * IT SHOWS STORED STATE, NEVER OPTIMISTIC STATE
 *
 * `optIn` is read from the row on every render, and the action revalidates
 * `/profile` before returning, so what the switch shows is always what the
 * database last confirmed. There is deliberately no local `useState` mirror and
 * no `useOptimistic`: on a failed write, an optimistic switch would sit in the
 * position the person chose while the column said the opposite — which on a
 * *mailing preference* means quietly telling somebody they have opted out when
 * they have not. Fail closed and honest: the position does not move, and the
 * error is stated underneath.
 *
 * §8's 44px target: the whole `<button>` is `min-h-11` with padding around the
 * 40×24 pill, so the tappable area is the row's full height rather than the
 * knob.
 */
export function EmailOptInToggle({
  optIn,
  labelledBy,
}: {
  /** The stored value. Rendered as-is; never second-guessed locally. */
  optIn: boolean;
  /** Id of the term this switch belongs to, so it is not announced as "On". */
  labelledBy: string;
}) {
  // The bound argument is the value this press would *store*, computed from the
  // stored state — so the action carries an explicit target rather than a
  // "flip it" instruction, and two rapid presses cannot race into an unintended
  // final value.
  //
  // The generics are explicit because the action takes no `FormData` — there is
  // no field to read, only the bound target — and without them the dispatcher's
  // payload type would be inferred as `void`, which a `<form action>` cannot be.
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateEmailOptInAction.bind(null, !optIn),
    initialActionState,
  );

  return (
    <form action={formAction} className="flex flex-col items-end">
      <button
        type="submit"
        role="switch"
        aria-checked={optIn}
        aria-labelledby={labelledBy}
        disabled={pending}
        className="flex min-h-11 items-center gap-2 rounded-full pl-2 disabled:opacity-70"
      >
        <span className="text-[12px] leading-[17px] font-medium">
          {pending ? "Saving…" : optIn ? "On" : "Off"}
        </span>
        <span
          aria-hidden
          className="relative block h-6 w-10 shrink-0 rounded-full transition-colors duration-200"
          style={{ background: optIn ? "var(--sc-accent)" : "rgba(13,18,32,.14)" }}
        >
          <span
            className="absolute top-[3px] block size-[18px] rounded-full bg-white transition-[left] duration-200"
            style={{ left: optIn ? 19 : 3 }}
          />
        </span>
      </button>

      {state.error === undefined ? null : (
        // `role="alert"` rather than a polite region: the person pressed
        // something and it did not happen, which they need told now. The switch
        // above still shows the stored state, so the two together say "nothing
        // changed, and here is why".
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
