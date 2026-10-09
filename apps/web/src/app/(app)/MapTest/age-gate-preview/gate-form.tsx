"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { GLASS } from "../../events/lib/surfaces";
import { acceptGateAction } from "./actions";
import { initialGateActionState } from "./action-state";

/**
 * The gate form itself. `acceptTerms` links nowhere real yet — the owner is
 * separately writing the actual Terms & Privacy Policy (amendment §10 launch
 * gate) — so this says so plainly instead of pointing at a page that does
 * not exist.
 */
export function GateForm() {
  const [state, formAction] = useActionState(acceptGateAction, initialGateActionState);

  if (state.done === true) {
    return (
      <div className="flex flex-col gap-2 rounded-[26px] p-[17px]" style={GLASS}>
        <h2 className="text-[15px] leading-5 font-semibold">Cleared</h2>
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
          Date of birth and terms acceptance recorded. Reload this page to see
          the updated state.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-[26px] p-[17px]" style={GLASS}>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] leading-[18px] font-medium">Date of birth</span>
        <input
          type="date"
          name="dateOfBirth"
          required
          className="rounded-2xl border px-4 py-2.5 text-[14px] leading-[19px] outline-none"
          style={{ borderColor: "rgba(13,18,32,.12)", background: "rgba(255,255,255,.7)" }}
        />
      </label>

      <label className="flex items-start gap-2 text-[13px] leading-[18px]">
        <input type="checkbox" name="acceptTerms" className="mt-0.5" required />
        <span>
          I accept the Terms & Privacy Policy. (Preview note: the real terms
          page does not exist yet — the owner is writing it separately, see
          the amendment&apos;s launch gate.)
        </span>
      </label>

      {state.error !== undefined ? (
        <p className="text-[13px] leading-[18px]" style={{ color: "#dc2626" }} role="alert">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 w-full rounded-full text-[14px] leading-[18px] font-semibold text-white disabled:opacity-60"
      style={{ background: "var(--sc-accent)" }}
    >
      {pending ? "Submitting…" : "Continue"}
    </button>
  );
}
