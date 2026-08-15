import Link from "next/link";
import { Lock } from "lucide-react";
import type { RsvpStatus } from "@smartcard/types";

import { BlurUpPhoto } from "@/components/blur-up-photo";
import type { EventAttendanceCounts } from "@/server/events/events-service";

import { dayLabel, monthLabel, timeLabel, whereLine } from "./lib/format";
import { RsvpPill } from "./lib/rsvp-pill";
import { COVER_PLACEHOLDER, GLASS } from "./lib/surfaces";

/**
 * One event card on the browse screen — the `data-screen-label="Events browse"`
 * card from `SmartCard 2.0.dc.html`, spec'd in `docs/design/DESIGN.md` §6:
 * "cards with cover, date chip, counts, seats left, 'you know N going', plus
 * Hosting/Private badges."
 *
 * PURE AND SYNCHRONOUS ON PURPOSE. Every fact it draws is passed in, already
 * resolved by the page. Two reasons, and the second is the load-bearing one:
 * it keeps the signed-cover-URL round trips batched at the page level instead
 * of serialised per card, and it makes the card renderable in a test, which is
 * how `access-rules.test.tsx` can assert that no viewer role ever gets a name
 * out of it.
 *
 * WHAT IT WILL NOT RENDER, WHATEVER IT IS PASSED
 *
 *  - No pending count. `counts.pending` is host-only and the card takes
 *    `EventStat`s built by `publicStats`, which has no way to express it.
 *  - No names. "You know 3 going" arrives as a finished sentence from
 *    `connectionsAttendingLine`; the ids behind it never leave the page module.
 */
export interface EventCardProps {
  eventId: string;
  title: string;
  startsAt: string;
  timezone: string | null;
  venueName: string | null;
  cityName: string;
  isPrivate: boolean;
  isHosting: boolean;
  /** Signed, short-lived URL for the cover, or `null` when there is no cover. */
  coverUrl: string | null;
  /** `null` when the counts could not be read — the card then states no numbers. */
  counts: EventAttendanceCounts | null;
  /** Already a sentence, never a list. `null` when there is nothing to say. */
  knowLine: string | null;
  /** The viewer's own STORED status (§7), or `null` if they have not answered. */
  ownStatus: RsvpStatus | null;
  /**
   * `events.status === 'cancelled'`. A card only ever renders this true for
   * somebody with a relationship to the event — the amended
   * `private.can_see_event` (20260815130200) drops cancelled events from the
   * public branch, so they are gone from browse for everybody else. The badge
   * exists so the people who kept it are told rather than left to work it out
   * from a date that has quietly stopped meaning anything.
   */
  isCancelled: boolean;
}

export function EventCard(props: EventCardProps) {
  return (
    <Link
      href={`/events/${props.eventId}`}
      className="block overflow-hidden rounded-[26px] transition-transform duration-300 hover:-translate-y-[3px]"
      style={{ ...GLASS, transitionTimingFunction: "var(--sc-ease-spring)" }}
    >
      <span className="relative block h-[132px]" style={COVER_PLACEHOLDER}>
        {props.coverUrl ? (
          <BlurUpPhoto src={props.coverUrl} alt="" className="size-full object-cover" />
        ) : (
          /*
           * §5's placeholder rule: a striped fill with a mono label naming what
           * belongs there — never a hand-drawn illustration, and never a stock
           * photo standing in for one the host did not upload.
           */
          <span
            className="absolute inset-0 flex items-center justify-center font-mono text-[10px]"
            style={{ color: "#7b8398" }}
            aria-hidden
          >
            <span className="rounded-md px-[9px] py-[5px]" style={{ background: "rgba(255,255,255,.86)" }}>
              no cover
            </span>
          </span>
        )}

        {/* Date chip — the event's own zone, see `lib/format.ts`. */}
        <span
          className="absolute top-3 left-3 flex h-[52px] w-12 flex-col items-center justify-center rounded-[15px] border"
          style={{
            background: "rgba(255,255,255,.82)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            borderColor: "rgba(255,255,255,.9)",
          }}
          aria-hidden
        >
          <span
            className="font-mono text-[9px] leading-3 font-medium"
            style={{ color: "var(--sc-accent)", letterSpacing: ".06em" }}
          >
            {monthLabel(props.startsAt, props.timezone)}
          </span>
          <span className="text-[19px] leading-[22px] font-semibold">
            {dayLabel(props.startsAt, props.timezone)}
          </span>
        </span>

        <span className="absolute top-3.5 right-3 flex gap-1.5">
          {/*
           * First in the row, and the only badge on this card painted with
           * `--danger`. §2 reserves that colour for destructive actions, and
           * this is the one place it is spent on a state instead: the state is
           * that the thing on the card is not happening, which is exactly what a
           * glance at a card should not be able to miss.
           */}
          {props.isCancelled ? (
            <span
              className="flex items-center rounded-full px-2.5 py-[5px] text-[10px] leading-[13px] font-semibold text-white"
              style={{ background: "var(--sc-danger)", backdropFilter: "blur(10px)" }}
            >
              Cancelled
            </span>
          ) : null}
          {props.isHosting ? (
            <span
              className="flex items-center rounded-full px-2.5 py-[5px] text-[10px] leading-[13px] font-semibold text-white"
              style={{ background: "rgba(13,18,32,.78)", backdropFilter: "blur(10px)" }}
            >
              Hosting
            </span>
          ) : null}
          {props.isPrivate ? (
            <span
              className="flex items-center gap-1 rounded-full px-[9px] py-[5px] text-[10px] leading-[13px] font-semibold"
              style={{
                background: "rgba(255,255,255,.85)",
                backdropFilter: "blur(10px)",
                color: "var(--sc-text-muted)",
              }}
            >
              <Lock size={10} strokeWidth={2.4} aria-hidden />
              Private
            </span>
          ) : null}
        </span>
      </span>

      <span className="block px-[17px] pt-[15px] pb-4">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] leading-[22px] font-semibold tracking-[-0.02em]">
              {props.title}
            </span>
            <span
              className="mt-0.5 block text-[13px] leading-[18px]"
              style={{ color: "var(--sc-text-muted)" }}
            >
              {timeLabel(props.startsAt, props.timezone)}
            </span>
            <span className="block text-[13px] leading-[18px]" style={{ color: "var(--sc-text-subtle)" }}>
              {whereLine(props.venueName, props.cityName)}
            </span>
          </span>
          {/*
           * §7: the STORED status, never the button that was tapped. Withheld
           * entirely on a cancelled event — a "Waiting on the host" pill beside a
           * "Cancelled" badge is two contradictory claims on one card, and the
           * pill's is the false one: nobody can answer that request, because the
           * decision path refuses a cancelled event.
           */}
          {props.ownStatus === null || props.isCancelled ? null : (
            <RsvpPill status={props.ownStatus} />
          )}
        </span>

        <CardMeta counts={props.counts} knowLine={props.knowLine} />
      </span>
    </Link>
  );
}

/**
 * The counts line. Public numbers only — see `publicStats`' doc block for why
 * `pending` cannot appear here even by accident.
 *
 * `counts === null` means the attendance RPC declined (the caller can no longer
 * see the event, most likely because it turned private between the two reads).
 * The line is then omitted entirely rather than rendered as zeroes: "0 going" is
 * a claim, and absence is the honest degradation (§7).
 */
function CardMeta({
  counts,
  knowLine,
}: {
  counts: EventAttendanceCounts | null;
  knowLine: string | null;
}) {
  const parts: React.ReactNode[] = [];

  if (counts !== null) {
    parts.push(<span key="going">{counts.going} going</span>);
    if (counts.seatsRemaining !== null) {
      parts.push(
        <span key="seats">
          {counts.seatsRemaining === 0 ? "Full" : `${counts.seatsRemaining} seats left`}
        </span>,
      );
    }
  }
  if (knowLine !== null) {
    parts.push(
      <span key="know" style={{ color: "var(--sc-accent-deep)" }}>
        {knowLine}
      </span>,
    );
  }
  if (parts.length === 0) return null;

  return (
    <span
      className="mt-3 flex flex-wrap items-center gap-2.5 text-[12px] leading-4 font-medium"
      style={{ color: "var(--sc-text-muted)" }}
    >
      {parts.map((part, index) => (
        <span key={index} className="flex items-center gap-2.5">
          {index > 0 ? (
            <span
              aria-hidden
              className="size-[3px] rounded-full"
              style={{ background: "#c3c9d6" }}
            />
          ) : null}
          {part}
        </span>
      ))}
    </span>
  );
}
