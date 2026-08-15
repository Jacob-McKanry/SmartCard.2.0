"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";

import { decideRsvpAction } from "../../actions";
import { initialEventActionState } from "../../action-state";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "../../lib/surfaces";

/**
 * One decision, one form, one bound Server Action.
 *
 * WHY `override` IS A SEPARATE BUTTON RATHER THAN A CHECKBOX OR A HIDDEN FIELD
 *
 * `decideRsvpAction` takes `override` as a **bound argument**, not as form data
 * — see that action's header. So admitting somebody past a full event's cap has
 * to be its own separately-rendered control that a host deliberately presses;
 * there is no field on the ordinary Approve form that a crafted request could
 * flip. The visual treatment matches: §5's destructive palette and the dashed
 * border §6 asks for, because it writes `event_rsvps.capacity_override` and that
 * column exists so an over-capacity event stays explainable months later.
 *
 * WHY THERE IS NO OPTIMISTIC UI HERE
 *
 * The stored outcome of "approve" is not knowable from the button: at a full
 * event an approve without override stores `waitlist`, not `going`
 * (`deriveDecidedRsvp`). Painting the row as approved and correcting it a moment
 * later would be rule 4 — render stored state, never the tap — broken in the
 * one place it would mislead a host about somebody else's seat. The row
 * re-renders from the database after `revalidatePath`.
 */
export function DecideButton({
  eventId,
  rsvpId,
  decision,
  override,
  label,
  variant,
  personName,
}: {
  eventId: string;
  rsvpId: string;
  decision: "approve" | "deny";
  override: boolean;
  label: string;
  variant: "primary" | "secondary" | "override";
  personName: string;
}) {
  const [state, formAction, pending] = useActionState(
    decideRsvpAction.bind(null, eventId, rsvpId, decision, override),
    initialEventActionState,
  );

  const style =
    variant === "primary"
      ? PRIMARY_BUTTON
      : variant === "override"
        ? {
            border: "1px dashed rgba(180,35,24,.45)",
            background: "rgba(180,35,24,.05)",
            color: "var(--sc-danger)",
          }
        : SECONDARY_BUTTON;

  return (
    <form action={formAction} className="contents">
      <button
        type="submit"
        disabled={pending}
        // §8: an icon-only or terse control still has to say who it acts on —
        // three identical "Approve" buttons on one screen are ambiguous to a
        // screen reader without this.
        aria-label={`${label} — ${personName}`}
        className="flex min-h-11 items-center gap-1.5 rounded-full px-[17px] text-[13px] leading-[17px] font-semibold disabled:opacity-70"
        style={style}
      >
        {variant === "primary" ? <Check size={15} strokeWidth={2.4} aria-hidden /> : null}
        {pending ? "Working…" : label}
      </button>
      {state.error !== undefined ? (
        <span
          role="alert"
          className="basis-full text-[12px] leading-[17px]"
          style={{ color: "var(--sc-danger)" }}
        >
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
