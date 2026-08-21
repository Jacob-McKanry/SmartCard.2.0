"use client";

import { useActionState } from "react";

import { claimCardAction } from "./actions";

/**
 * The claim button, and the small amount of state a one-way action needs.
 *
 * WHY `useActionState` AND NOT AN OPTIMISTIC FLIP. The same reasoning
 * `email-opt-in-toggle.tsx` records for its switch, sharpened by the stakes: a
 * control that reports success before the server has agreed would tell somebody
 * a physical card is theirs when it may have gone to whoever pressed first. Two
 * people can hold the same code — one of them is going to lose, and the
 * database decides which at the moment of the UPDATE. So nothing here moves
 * until the action returns.
 *
 * WHY THE BUTTON DISAPPEARS ON SUCCESS RATHER THAN STAYING PRESSABLE. Claiming
 * is one-way: `assigned -> unassigned` is not a transition anything in this
 * product performs, so there is no second press that could mean anything. A
 * button that survives its own success invites one.
 *
 * WHY A FAILED CLAIM IS NOT ENCOURAGED TO RETRY. The button stays live and the
 * person can press again, but the copy never suggests that trying again will
 * help — every refusal spends budget from both limits (20260821120000), so an
 * encouraging "try again" would be teaching somebody to exhaust their own
 * hourly allowance against a card that is never going to be claimable.
 */

type ClaimState = { status: "idle" } | { status: "claimed" } | { status: "failed"; message: string };

export function ClaimCardButton({ code }: { code: string }) {
  const [state, formAction, pending] = useActionState<ClaimState, FormData>(
    async () => {
      try {
        await claimCardAction(code);
        return { status: "claimed" };
      } catch (thrown) {
        // `UserFacingError`'s message is the only thing allowed across this
        // boundary (`server/errors.ts`); anything else has already been
        // replaced with one generic sentence server-side, so this renders what
        // reached it without inspecting it further.
        return {
          status: "failed",
          message:
            thrown instanceof Error
              ? thrown.message
              : "This card couldn't be claimed. Check the code and try again.",
        };
      }
    },
    { status: "idle" },
  );

  if (state.status === "claimed") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-[15px] leading-[21px] font-semibold">This card is yours now.</p>
        <p
          className="max-w-[34ch] text-[13px] leading-[19px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          Anyone who taps it will see your profile. You can revoke it any time from Activity.
        </p>
        <a
          href="/profile"
          className="inline-flex min-h-11 items-center justify-center rounded-full px-5 text-[14px] font-semibold text-white"
          style={{
            background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
            boxShadow: "0 12px 28px -12px rgba(11,96,255,.55)",
          }}
        >
          Set up your profile
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col items-stretch gap-3">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-full px-5 text-[14px] font-semibold text-white disabled:opacity-60"
        style={{
          background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
          boxShadow: "0 12px 28px -12px rgba(11,96,255,.55)",
        }}
      >
        {pending ? "Claiming…" : "Claim this card"}
      </button>

      {state.status === "failed" && (
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-danger, #b3261e)" }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
