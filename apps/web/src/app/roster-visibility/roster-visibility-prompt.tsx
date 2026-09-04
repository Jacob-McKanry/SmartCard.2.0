"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { initialActionState, type ActionState } from "@/app/(app)/profile/action-state";

import { chooseRosterVisibilityAction, skipRosterVisibilityAction } from "./actions";

/**
 * The one-time roster-visibility prompt — §3.3's third choice surface, see
 * `page.tsx`'s own header for who reaches this screen.
 *
 * TWO EQUAL BUTTONS, NEITHER PRE-SELECTED, SAME AS THE CLAIM SCREEN'S OWN
 * CHOICE (`claim-review.tsx`'s `RosterVisibilityChoice`) — §8.4's still-open
 * question, resolved the same way in both places: a pre-selected "show me"
 * is a dark pattern on a consent gate, a pre-selected "keep me hidden" makes
 * an unexplained feature look broken.
 *
 * UNLIKE THE CLAIM SCREEN, "NOT NOW" IS OFFERED HERE — DELIBERATELY
 *
 * The claim-review choice sits inside a form the person is already
 * completing as one deliberate act; this page is sprung on someone mid
 * sign-in with no other business on the screen. Onboarding's own established
 * rule — "every step can be skipped, and skipping still counts as
 * finishing" (`onboarding/onboarding-flow.tsx`'s header) — applies with equal
 * force here: nothing downstream requires an answer, `roster_visibility`
 * already fails closed to hidden when unset, and forcing a decision from
 * someone who has not been told why they are being asked would be the wrong
 * kind of insistence for a courtesy prompt. "Not now" answers the PROMPT
 * (stamps `roster_visibility_chosen_at`, see `skipRosterVisibilityAction`)
 * without answering the QUESTION, and the person can still choose later from
 * profile settings.
 */
export function RosterVisibilityPrompt() {
  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-[402px] flex-col gap-5 px-[26px] pt-8 pb-9"
      style={{ animation: "sc-rise .45s var(--sc-ease-glide) both" }}
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-[26px] leading-[30px] font-semibold" style={{ letterSpacing: "-.035em" }}>
          Show up on event guest lists?
        </h1>
        <p
          className="text-[14px] leading-[21px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          At any event you attend, other attendees who&rsquo;ve made the same choice can see and
          save each other&rsquo;s contact card. Nobody sees this before the event starts, and it
          never creates a connection — that still only happens through an in-person tap or scan.
        </p>
      </div>

      <div
        className="flex flex-col gap-3 rounded-[24px] border p-[17px]"
        style={{
          background: "var(--sc-glass-bg)",
          backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
          WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
          borderColor: "var(--sc-glass-bd)",
          boxShadow: "var(--sc-glass-sh)",
        }}
      >
        <ChoiceButton visible action={chooseRosterVisibilityAction.bind(null, true)}>
          Yes, show my card
        </ChoiceButton>
        <ChoiceButton visible={false} action={chooseRosterVisibilityAction.bind(null, false)}>
          No, keep me hidden
        </ChoiceButton>
      </div>

      <div className="flex-1" />

      {/*
       * A separate one-button form, like `skipOnboardingAction`'s own — a
       * second submit button inside the form above would post whichever
       * choice happens to be focused, which is not what "not now" means.
       */}
      <form action={skipRosterVisibilityAction}>
        <SkipButton />
      </form>

      <p
        role="note"
        className="text-center text-[12px] leading-[17px]"
        style={{ color: "var(--sc-text-subtle)" }}
      >
        Change this any time from your profile.
      </p>
    </main>
  );
}

function ChoiceButton({
  visible,
  action,
  children,
}: {
  visible: boolean;
  action: (prevState: ActionState) => Promise<ActionState>;
  children: React.ReactNode;
}) {
  // Explicit generics, matching `EmailOptInToggle`'s own reasoning: the bound
  // action takes no `FormData` payload, so without them the dispatcher's
  // payload type infers as `void`, which a `<form action>` cannot be.
  const [state, formAction] = useActionState<ActionState, FormData>(action, initialActionState);

  return (
    <form action={formAction}>
      <SubmitButton visible={visible}>{children}</SubmitButton>
      {state.error === undefined ? null : (
        <p role="alert" className="mt-1.5 text-[12px] leading-4" style={{ color: "var(--sc-danger)" }}>
          {state.error}
        </p>
      )}
    </form>
  );
}

function SubmitButton({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex min-h-11 w-full items-center justify-center rounded-full px-4 py-4 text-[15px] leading-[19px] font-semibold text-white disabled:opacity-70"
      style={
        visible
          ? {
              background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
              boxShadow: "0 16px 32px -12px rgba(11,96,255,.55)",
            }
          : {
              background: "var(--sc-text)",
              color: "#ffffff",
              boxShadow: "0 8px 20px -8px rgba(13,18,32,.5)",
            }
      }
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

function SkipButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex min-h-11 w-full items-center justify-center rounded-full px-5 py-4 text-[15px] leading-[19px] font-semibold disabled:opacity-70"
      style={{
        border: "1px solid rgba(13,18,32,.12)",
        background: "rgba(255,255,255,.6)",
        color: "var(--sc-text-muted)",
      }}
    >
      {pending ? "One moment…" : "Not now"}
    </button>
  );
}
