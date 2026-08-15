import type { RsvpStatus } from "@smartcard/types";

/**
 * The status pills of `docs/design/DESIGN.md` §5, and the only implementation
 * of them in the app.
 *
 * §5 lists five treatments and closes with "Never invent a sixth treatment", so
 * this is a **total switch** over `RsvpStatus` rather than a lookup with a
 * default. Adding a seventh status to the enum becomes a type error here rather
 * than a silently generic grey pill somewhere nobody looked.
 *
 *   going       the ONLY solid accent pill in the whole system
 *   interested  outline accent
 *   waitlist    accent-tinted (see the note on positions below)
 *   pending     white glass, `--pending` label — §2: that hue means
 *               *waiting on someone*, never a success, and is text-only
 *   not_going   neutral
 *   denied      neutral, and the screen beside it offers the ask-again path
 *
 * §8: colour is never the only signal. Every pill carries its own words, so the
 * state survives greyscale, colour-blindness and a screenshot.
 *
 * WHY THE WAITLIST PILL CARRIES NO POSITION
 *
 * §5 describes waitlist as "accent-tinted with a position", and the position is
 * omitted for a viewer looking at their own answer because the backend cannot
 * tell them. Computing "you are 3rd" needs the `responded_at` of everybody else
 * waiting, and the `event_rsvps` select policy returns only your own row and
 * your connections' — by design, since that set is an attendee list. A number
 * derived from the fragment a viewer *can* read would be wrong and confidently
 * so. The host's queue does show positions, because a host legitimately holds
 * the whole waiting list through `event_rsvp_queue`; `waitlistLabel` below
 * takes the position as an argument for that one caller.
 */

export interface RsvpPillStyle {
  label: string;
  background: string;
  color: string;
  borderColor: string;
}

export function rsvpPillStyle(status: RsvpStatus): RsvpPillStyle {
  switch (status) {
    case "going":
      return {
        label: "Going",
        background: "var(--sc-accent)",
        color: "#ffffff",
        borderColor: "var(--sc-accent)",
      };
    case "interested":
      return {
        label: "Interested",
        background: "rgba(11,96,255,.08)",
        color: "var(--sc-accent-deep)",
        borderColor: "rgba(11,96,255,.32)",
      };
    case "waitlist":
      return {
        label: "Waitlisted",
        background: "rgba(11,96,255,.06)",
        color: "var(--sc-accent-deep)",
        borderColor: "rgba(11,96,255,.22)",
      };
    case "pending":
      return {
        label: "Waiting on host",
        background: "rgba(255,255,255,.72)",
        color: "var(--sc-pending)",
        borderColor: "rgba(13,18,32,.14)",
      };
    case "not_going":
      return {
        label: "Not going",
        background: "rgba(13,18,32,.04)",
        color: "var(--sc-text-muted)",
        borderColor: "rgba(13,18,32,.12)",
      };
    case "denied":
      return {
        label: "Not admitted",
        background: "rgba(13,18,32,.04)",
        color: "var(--sc-text-muted)",
        borderColor: "rgba(13,18,32,.1)",
      };
  }
}

export function RsvpPill({
  status,
  size = "sm",
}: {
  status: RsvpStatus;
  /** `sm` on list rows, `md` on the detail screen's answer panel. */
  size?: "sm" | "md";
}) {
  const style = rsvpPillStyle(status);
  const metrics =
    size === "md"
      ? "px-[15px] py-2 text-[13px] leading-[17px]"
      : "px-[11px] py-[5px] text-[11px] leading-[14px]";

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border font-semibold ${metrics}`}
      style={{ background: style.background, color: style.color, borderColor: style.borderColor }}
    >
      {style.label}
    </span>
  );
}

/**
 * `3rd in line` — host-queue only. See the header for why a person's own screen
 * never gets one of these.
 */
export function waitlistLabel(position: number): string {
  const suffix =
    position % 100 >= 11 && position % 100 <= 13
      ? "th"
      : position % 10 === 1
        ? "st"
        : position % 10 === 2
          ? "nd"
          : position % 10 === 3
            ? "rd"
            : "th";
  return `${position}${suffix} in line`;
}
