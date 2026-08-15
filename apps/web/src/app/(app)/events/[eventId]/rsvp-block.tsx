"use client";

import { useActionState, useCallback, useState } from "react";
import { Check, Clock } from "lucide-react";
import type { RsvpIntent, RsvpStatus } from "@smartcard/types";

import { ConfirmPanel } from "../../connections/lib/confirm-panel";
import { requestRsvpAction, withdrawRsvpAction } from "../actions";
import { initialEventActionState } from "../action-state";
import { rsvpMismatchNotice } from "../lib/access-rules";
import { RsvpPill } from "../lib/rsvp-pill";
import { GLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../lib/surfaces";

/**
 * The RSVP block: three things a person can say, six things the app can hold.
 *
 * RULE 4 IS THE WHOLE DESIGN OF THIS COMPONENT (`DESIGN.md` §7: "Render stored
 * state, not the tapped intent").
 *
 * `storedStatus` is a **prop from the server**, read back out of `event_rsvps`
 * after `revalidatePath`. It is what the pill renders. The action's own return
 * value is deliberately *not* used to drive the pill — it is used only to
 * detect that what came back differs from what was asked for, and to say so.
 * That ordering matters: if the two ever disagree, the row in the database is
 * the truth and the button somebody pressed is not.
 *
 * So tapping "Going" on an approval-gated event draws a `Waiting on host` pill
 * and a sentence explaining that the tap became a request rather than a seat.
 * The word "Going" never appears as the viewer's state at any point in that
 * flow, including for the instant between the tap and the refresh.
 *
 * WHY WITHDRAWAL GOES THROUGH THE APP'S CONFIRM PANEL
 *
 * §7's "destructive = two steps, one way", and withdrawal earns it on three
 * counts a person would not otherwise see coming: it is not the same as
 * answering "not going" (it removes the answer entirely), it can promote
 * somebody off the waitlist in the same transaction, and on a *private* event
 * the RSVP row may be the only thing making the event visible — so withdrawing
 * can end the viewer's access to the page they are standing on. The panel names
 * each of those separately, which is what §7 asks for and what a single
 * "are you sure?" would not do.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 *  - No waitlist position. See `lib/rsvp-pill.tsx`: the number is not
 *    computable from what a person may read about an event they are on the
 *    waitlist for, and a number computed from the readable fragment would be
 *    confidently wrong.
 *  - No "notify the host" / "ask again for a nudge" control on `pending`.
 *    Nothing like it exists, and §7 forbids implying it.
 *  - No "Going" button once an event has ended. `request_event_rsvp` refuses it
 *    (`event_ended`), and the reason is a real one — two `going` answers make
 *    two strangers' profiles mutually readable — so the control is removed
 *    rather than left to fail.
 */
export function RsvpBlock({
  eventId,
  storedStatus,
  requiresApproval,
  isFull,
  hasEnded,
  isPrivate,
  isHost,
}: {
  eventId: string;
  /** `event_rsvps.status` as stored, or `null` when the viewer has not answered. */
  storedStatus: RsvpStatus | null;
  requiresApproval: boolean;
  isFull: boolean;
  hasEnded: boolean;
  isPrivate: boolean;
  isHost: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    requestRsvpAction.bind(null, eventId),
    initialEventActionState,
  );
  /**
   * The last intent this browser submitted. Held here rather than derived from
   * the action's result because the result cannot say what was asked — that is
   * exactly the asymmetry rule 4 exists for.
   */
  const [lastIntent, setLastIntent] = useState<RsvpIntent | null>(null);
  const [changing, setChanging] = useState(false);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);

  const cancelWithdraw = useCallback(() => setConfirmingWithdraw(false), []);
  const withdraw = useCallback(async () => {
    await withdrawRsvpAction(eventId, initialEventActionState);
    setConfirmingWithdraw(false);
    setLastIntent(null);
  }, [eventId]);

  const mismatch =
    lastIntent === null || state.status === undefined
      ? null
      : rsvpMismatchNotice(lastIntent, state.status);

  const showChoices = storedStatus === null || changing;

  return (
    <section className="flex flex-col gap-3 rounded-[26px] p-[17px]" style={GLASS}>
      <h2 className="text-[13px] leading-[17px] font-semibold">
        {storedStatus === null
          ? isHost
            ? "Your own answer"
            : "Are you going?"
          : "Your answer"}
      </h2>

      {storedStatus !== null ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <RsvpPill status={storedStatus} size="md" />
        </div>
      ) : null}

      {mismatch !== null ? (
        <p
          className="rounded-[17px] px-[13px] py-3 text-[12px] leading-[17px]"
          style={{
            background: "rgba(13,18,32,.035)",
            color: "var(--sc-text-muted)",
            textWrap: "pretty",
          }}
        >
          {mismatch}
        </p>
      ) : null}

      {storedStatus !== null ? <StatusExplainer status={storedStatus} /> : null}

      {isHost && storedStatus === null ? (
        <p className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-muted)" }}>
          Hosting does not answer for you. Your own seat is a separate answer, and only a{" "}
          <em>going</em> one puts you and other guests in the same room as far as the app is
          concerned.
        </p>
      ) : null}

      {showChoices ? (
        <form action={formAction} className="flex flex-wrap gap-2">
          {hasEnded ? null : (
            <IntentButton
              intent="going"
              label="Going"
              icon={<Check size={16} strokeWidth={2.4} aria-hidden />}
              variant="primary"
              pending={pending}
              onPick={setLastIntent}
            />
          )}
          <IntentButton
            intent="interested"
            label="Interested"
            variant="accent-outline"
            pending={pending}
            onPick={setLastIntent}
          />
          <IntentButton
            intent="not_going"
            label="Can't make it"
            variant="neutral"
            pending={pending}
            onPick={setLastIntent}
          />
        </form>
      ) : null}

      {showChoices ? <BeforeYouTap
        hasEnded={hasEnded}
        requiresApproval={requiresApproval}
        isFull={isFull}
      /> : null}

      {state.error !== undefined ? (
        <p className="text-[12px] leading-[17px]" role="alert" style={{ color: "var(--sc-danger)" }}>
          {state.error}
        </p>
      ) : null}

      {state.success === true && (state.promoted ?? 0) > 0 ? (
        <p className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-muted)" }}>
          {state.promoted === 1
            ? "One person moved off the waitlist into the seat you freed."
            : `${state.promoted} people moved off the waitlist into the seats you freed.`}
        </p>
      ) : null}

      {storedStatus !== null ? (
        <div className="flex flex-wrap items-center gap-2">
          {changing ? (
            <button
              type="button"
              onClick={() => setChanging(false)}
              className="min-h-11 rounded-full px-[17px] text-[13px] leading-[17px] font-semibold"
              style={SECONDARY_BUTTON}
            >
              Keep my answer
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setChanging(true)}
              className="min-h-11 rounded-full px-[17px] text-[13px] leading-[17px] font-semibold"
              style={SECONDARY_BUTTON}
            >
              {storedStatus === "denied" ? "Ask again" : "Change answer"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmingWithdraw(true)}
            className="min-h-11 px-1.5 text-[13px] leading-[17px] font-semibold"
            style={{ color: "var(--sc-text-subtle)" }}
          >
            Withdraw
          </button>
        </div>
      ) : null}

      <ConfirmPanel
        open={confirmingWithdraw}
        onCancel={cancelWithdraw}
        title="Withdraw your answer?"
        confirmLabel="Yes, withdraw"
        consequences={withdrawConsequences(storedStatus, isPrivate)}
        action={withdraw}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ parts */

/**
 * One intent button. `name="intent"` + `value` is what the Server Action reads,
 * so this is an ordinary form submission and works without JavaScript; the
 * `onPick` is only there to remember what was asked so rule 4's explanation can
 * be written afterwards.
 */
function IntentButton({
  intent,
  label,
  icon,
  variant,
  pending,
  onPick,
}: {
  intent: RsvpIntent;
  label: string;
  icon?: React.ReactNode;
  variant: "primary" | "accent-outline" | "neutral";
  pending: boolean;
  onPick: (intent: RsvpIntent) => void;
}) {
  const style =
    variant === "primary"
      ? PRIMARY_BUTTON
      : variant === "accent-outline"
        ? {
            background: "rgba(11,96,255,.06)",
            border: "1px solid rgba(11,96,255,.32)",
            color: "var(--sc-accent-deep)",
          }
        : SECONDARY_BUTTON;

  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      disabled={pending}
      onClick={() => onPick(intent)}
      className={`flex min-h-[52px] items-center justify-center gap-[7px] rounded-full px-[18px] text-[14px] leading-[18px] font-semibold disabled:opacity-70 ${
        variant === "neutral" ? "" : "min-w-[110px] flex-1"
      }`}
      style={style}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * The honest warning *before* the tap — the other half of rule 4.
 *
 * Rule 4 says the screen must report what was stored. Saying it in advance is
 * better than only correcting afterwards, and it is possible here because the
 * event's own `requires_approval` and fullness are already on the page. This is
 * the one place `@smartcard/core`'s truth table is mirrored in copy; the SQL
 * remains the authority, so this is phrased as what the host has configured
 * rather than as a promise about the outcome.
 */
function BeforeYouTap({
  hasEnded,
  requiresApproval,
  isFull,
}: {
  hasEnded: boolean;
  requiresApproval: boolean;
  isFull: boolean;
}) {
  const lines: string[] = [];
  if (hasEnded) {
    lines.push(
      "This event has already happened, so there is no seat left to take — you can still record that you were interested.",
    );
  } else if (requiresApproval) {
    lines.push(
      "The host approves each guest. Tapping Going puts you in their queue; it does not seat you.",
    );
  } else if (isFull) {
    lines.push(
      "This event is full. Tapping Going puts you on the waitlist, and you move up automatically the moment a seat frees.",
    );
  }
  if (lines.length === 0) return null;

  return (
    <div
      className="flex items-start gap-2 text-[12px] leading-[17px]"
      style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
    >
      <Clock size={13} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
      <span>{lines.join(" ")}</span>
    </div>
  );
}

/**
 * What each stored status actually means for the person holding it.
 *
 * A total switch, like the pill itself: every status this app can store has a
 * sentence, and a new one becomes a type error rather than a blank space. Two
 * of these exist specifically to *stop* a control being invented —
 * `pending` says there is nothing to do because there is no nudge to send, and
 * `waitlist` says promotion is automatic because there is no queue to refresh
 * and no per-event setting that changes it.
 */
function StatusExplainer({ status }: { status: RsvpStatus }) {
  const copy = ((): string | null => {
    switch (status) {
      case "pending":
        return "Nothing to do — you'll know when the host decides. There's no nudge to send from here.";
      case "waitlist":
        return "If a seat frees you're moved up automatically, in the same moment it happens. There's no queue to refresh and nothing to claim.";
      case "denied":
        return "Not a dead end — you can ask again, and it goes back to the host as a fresh request.";
      case "going":
        return "You have a seat. Anyone else going can see the same counts you can, and no one can see a list of who is here.";
      case "interested":
        return "Interested doesn't take a seat, and it isn't shown to the host as a request.";
      case "not_going":
        return "Recorded as a no. You can change it while the event is still ahead.";
    }
  })();
  if (copy === null) return null;

  return (
    <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}>
      {copy}
    </p>
  );
}

/**
 * §7 requires the second step of a destructive action to name the consequences
 * *individually*. These are the real ones, and the private-event line is only
 * shown when it is true.
 */
function withdrawConsequences(status: RsvpStatus | null, isPrivate: boolean): string[] {
  const lines = [
    "Your answer is removed completely. That is not the same as answering “not going”, which is still an answer.",
  ];
  if (status === "going") {
    lines.push(
      "Your seat is freed, and whoever has waited longest is moved into it immediately — there is no way to take it back.",
    );
  }
  if (status === "waitlist") {
    lines.push("You lose your place in the waiting order. Asking again puts you at the back.");
  }
  if (isPrivate) {
    lines.push(
      "This event is private. Your answer may be the only reason you can see it, so withdrawing can end your access to this page.",
    );
  }
  return lines;
}
