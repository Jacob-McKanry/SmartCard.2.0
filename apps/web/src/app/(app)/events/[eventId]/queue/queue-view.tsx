import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { waitlistPositionOf } from "@smartcard/core";

import type { HostQueueEntry } from "@/server/events/events-service";
import { AvatarDisc } from "../../../connections/lib/avatar-disc";
import { decidableQueueEntries, type ViewerRole } from "../../lib/access-rules";
import { askedAtLine, displayName, initialsFor } from "../../lib/format";
import { RsvpPill, waitlistLabel } from "../../lib/rsvp-pill";
import { GLASS } from "../../lib/surfaces";
import { DecideButton } from "./decide-button";

/**
 * THE HOST APPROVAL QUEUE — `docs/design/DESIGN.md` §6 and the
 * `data-screen-label="Host approval queue"` block of the prototype.
 *
 * THIS IS A DECISION QUEUE, NOT A GUEST LIST, AND THE DIFFERENCE IS THE POINT
 *
 * The prototype and `docs/design-lab-reference.md` both describe this screen as
 * showing everyone `pending`, `waitlist` **and `going`**, and
 * `public.event_rsvp_queue` returns all three. This screen renders only the
 * first two. The access rule — no attendee list, for anybody, host included —
 * wins over the design detail, and it is recorded here rather than only in a
 * commit message.
 *
 * It costs the host nothing, which is why the trade is clean rather than a
 * compromise. A `going` row is **not decidable**: `public.decide_event_rsvp`
 * refuses anything that is not `pending` or `waitlist` with `not_decidable`,
 * because approving an approved person is a no-op and denying them would be an
 * *eject*, which this product deliberately does not have. So those rows could
 * only ever have been looked at. "A list of who is attending, to look at" is
 * exactly the thing there is no version of here. The host still sees how many
 * are going — on the event page, in the same four-stat row everybody else sees.
 *
 * WHY THE GATE IS REPEATED IN THIS COMPONENT
 *
 * `role !== "host"` returns `null` before anything renders, even though the page
 * has already refused a non-host with `notFound()` and the RPC returns no rows
 * to one either. Three gates for one screen is the right number when the screen
 * is the single place in this feature that shows a caller people's names: the
 * page's gate is about routing, the RPC's is the real enforcement, and this one
 * makes the rule testable as a rule — `access-rules.test.tsx` renders this
 * component as a non-host and asserts nothing comes out.
 */
export function QueueView({
  role,
  eventId,
  eventTitle,
  seatsRemaining,
  entries,
  photoUrls,
}: {
  role: ViewerRole;
  eventId: string;
  eventTitle: string;
  /** `null` when the event has no capacity set. */
  seatsRemaining: number | null;
  /** Straight from `getHostRsvpQueue` — filtered to decidable rows in here. */
  entries: readonly HostQueueEntry[];
  /** Signed photo URLs by user id, minted by the page. Missing is normal. */
  photoUrls: Readonly<Record<string, string | null>>;
}) {
  if (role !== "host") {
    return null;
  }

  const rows = decidableQueueEntries(entries);

  const waiting = rows.filter((entry) => entry.status === "pending").length;
  const waitlistEntries = rows
    .filter((entry) => entry.status === "waitlist")
    .map((entry) => ({
      rsvpId: entry.rsvpId,
      userId: entry.userId,
      respondedAt: entry.respondedAt,
    }));
  const isFull = seatsRemaining === 0;

  return (
    <main
      className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-[22px] pt-4 sm:px-7"
      style={{ animation: "sc-rise .5s var(--sc-ease-glide) both" }}
    >
      <Link
        href={`/events/${eventId}`}
        className="-ml-1 flex min-h-11 items-center gap-1.5 self-start px-1 text-[13px] leading-[18px] font-medium"
        style={{ color: "var(--sc-text-muted)" }}
      >
        <ChevronLeft size={16} strokeWidth={2} aria-hidden />
        {eventTitle}
      </Link>

      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[27px] leading-[31px] font-semibold tracking-[-0.03em]">
            Approval queue
          </h1>
          <span
            className="rounded-full px-[11px] py-[5px] text-[10px] leading-[13px] font-semibold text-white"
            style={{ background: "var(--sc-text)" }}
          >
            Host only
          </span>
        </div>
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
          {seatsRemaining === null
            ? "No capacity set"
            : seatsRemaining === 0
              ? "Full — every seat taken"
              : `${seatsRemaining} ${seatsRemaining === 1 ? "seat" : "seats"} left`}{" "}
          · {waiting} waiting on you
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyQueue />
      ) : (
        <ul className="flex flex-col gap-2.5 pb-2">
          {rows.map((entry) => (
            <li key={entry.rsvpId}>
              <QueueRow
                eventId={eventId}
                entry={entry}
                photoUrl={photoUrls[entry.userId] ?? null}
                isFull={isFull}
                waitlistPosition={
                  entry.status === "waitlist"
                    ? waitlistPositionOf(waitlistEntries, entry.userId)
                    : null
                }
              />
            </li>
          ))}
        </ul>
      )}

      <p
        className="max-w-[54ch] pb-2 text-[12px] leading-[17px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        Only people waiting on a decision from you appear here. Anyone who tapped Interested or
        Can&rsquo;t make it never enters this queue, and there is no list anywhere of who is going.
      </p>
    </main>
  );
}

function QueueRow({
  eventId,
  entry,
  photoUrl,
  isFull,
  waitlistPosition,
}: {
  eventId: string;
  entry: HostQueueEntry;
  photoUrl: string | null;
  isFull: boolean;
  waitlistPosition: number | null;
}) {
  const name = displayName({ first_name: entry.firstName, last_name: entry.lastName });

  return (
    <div className="flex flex-col gap-3 rounded-[22px] p-[15px]" style={GLASS}>
      <div className="flex items-center gap-3">
        <AvatarDisc
          size={42}
          fontSize={13}
          initials={initialsFor({ first_name: entry.firstName, last_name: entry.lastName })}
          photoUrl={photoUrl}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] leading-5 font-semibold tracking-[-0.01em]">{name}</p>
          <p className="truncate text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
            Asked {askedAtLine(entry.respondedAt)}
            {waitlistPosition === null ? "" : ` · ${waitlistLabel(waitlistPosition)}`}
          </p>
        </div>
        <RsvpPill status={entry.status} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DecideButton
          eventId={eventId}
          rsvpId={entry.rsvpId}
          decision="approve"
          override={false}
          label="Approve"
          variant="primary"
          personName={name}
        />
        <DecideButton
          eventId={eventId}
          rsvpId={entry.rsvpId}
          decision="deny"
          override={false}
          label="Deny"
          variant="secondary"
          personName={name}
        />
        {/*
         * THE OVERRIDE, AND WHY IT APPEARS WHENEVER THE EVENT IS FULL.
         *
         * The prototype draws this only on waitlist rows. It is shown for
         * `pending` rows too, because the database treats them the same: at a
         * full event, a plain approve of a `pending` row stores `waitlist`, not
         * `going` (`deriveDecidedRsvp`). Hiding the override there would leave a
         * host pressing Approve and watching nothing appear to happen — the
         * exact silent-failure shape §7 rules out.
         *
         * §5's destructive treatment plus the dashed border the design asks for:
         * this is a recorded exception (`event_rsvps.capacity_override`), not a
         * second Approve button.
         */}
        {isFull ? (
          <DecideButton
            eventId={eventId}
            rsvpId={entry.rsvpId}
            decision="approve"
            override
            label="Admit past capacity"
            variant="override"
            personName={name}
          />
        ) : null}
      </div>
    </div>
  );
}

function EmptyQueue() {
  return (
    <div
      className="flex flex-col items-center gap-2.5 rounded-[26px] border border-dashed px-6 py-8 text-center"
      style={{ borderColor: "rgba(13,18,32,.16)", background: "rgba(255,255,255,.45)" }}
    >
      <p className="text-[14px] leading-[19px] font-semibold">Nobody is waiting on you</p>
      <p
        className="max-w-[40ch] text-[13px] leading-[19px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        This queue holds people asking for a seat. It is empty whenever every request has been
        settled — which, for an event that needs no approval and has room, is all the time.
      </p>
    </div>
  );
}
