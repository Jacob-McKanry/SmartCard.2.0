import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import type { EventRosterEntry } from "@smartcard/types";

import { AvatarDisc } from "../../../connections/lib/avatar-disc";
import { canViewRoster, type ViewerRole } from "../../lib/access-rules";
import { displayName, initialsFor } from "../../lib/format";
import { GLASS } from "../../lib/surfaces";

/**
 * THE EVENT ATTENDEE ROSTER — `docs/architecture/2026-08-27-event-attendee-roster.md`.
 *
 * WHAT THIS IS NOT, STATED AS PLAINLY AS `queue-view.tsx` STATES ITS OWN RULE
 *
 * This is not the attendee list `access-rules.ts`'s Rule 1 forbids —
 * §3.3's whole design is that it is narrower on every axis that rule cares
 * about: only opted-in people appear (unanswered = hidden, §3.3's own
 * invariant), only to fellow attendees of the SAME event (not any viewer,
 * not a directory), and only once the event has actually started (§3.2).
 * Tapping a row never creates a connection — that still only happens
 * through an in-person NFC tap or a live, GPS-verified QR scan
 * (CLAUDE.md's non-negotiable rule) — which is why the footer below says so
 * explicitly rather than leaving it implied.
 *
 * WHY THE GATE IS REPEATED HERE, MATCHING `QueueView`'s OWN REASONING
 *
 * `event_roster` already refuses a non-member with an empty result and the
 * page already 404s one — this third check makes the rule testable as a
 * rule (`access-rules.test.tsx`), not decorative redundancy.
 */
export function RosterView({
  role,
  wasClaimedGuest,
  eventId,
  eventTitle,
  isCancelled,
  hasStarted,
  entries,
  photoUrls,
}: {
  role: ViewerRole;
  wasClaimedGuest: boolean;
  eventId: string;
  eventTitle: string;
  isCancelled: boolean;
  hasStarted: boolean;
  entries: readonly EventRosterEntry[];
  photoUrls: Readonly<Record<string, string | null>>;
}) {
  if (!canViewRoster(role, wasClaimedGuest)) {
    return null;
  }

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
        <h1 className="text-[27px] leading-[31px] font-semibold tracking-[-0.03em]">
          Who&rsquo;s here
        </h1>
        <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
          Attendees who&rsquo;ve chosen to be visible to each other at this event.
        </p>
      </header>

      {isCancelled ? (
        <EmptyState
          title="This event was cancelled"
          body="There's no roster for an event that isn't happening."
        />
      ) : !hasStarted ? (
        <EmptyState
          title="Opens once the event starts"
          body="Nobody can see this roster yet, including the host — it opens the moment the event begins and stays open to attendees only."
        />
      ) : entries.length === 0 ? (
        <EmptyState
          title="No one visible here yet"
          body="Attendees only show up once they've chosen to be visible. That can change as more people opt in, even after the event starts."
        />
      ) : (
        <ul className="flex flex-col gap-2.5 pb-2">
          {entries.map((entry) => (
            <li key={entry.user_id}>
              <RosterRow eventId={eventId} entry={entry} photoUrl={photoUrls[entry.user_id] ?? null} />
            </li>
          ))}
        </ul>
      )}

      <p
        className="max-w-[54ch] pb-2 text-[12px] leading-[17px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        Only attendees who&rsquo;ve opted in appear here, and only to each other — nobody outside
        this event can see this list. Viewing or saving someone&rsquo;s card here never connects
        you; to add this person on SmartCard, please connect in person.
      </p>
    </main>
  );
}

function RosterRow({
  eventId,
  entry,
  photoUrl,
}: {
  eventId: string;
  entry: EventRosterEntry;
  photoUrl: string | null;
}) {
  const name = displayName({ first_name: entry.first_name, last_name: entry.last_name });

  return (
    <Link
      href={`/events/${eventId}/roster/${entry.user_id}`}
      className="flex items-center gap-3 rounded-[22px] p-[15px]"
      style={GLASS}
    >
      <AvatarDisc
        size={42}
        fontSize={13}
        initials={initialsFor({ first_name: entry.first_name, last_name: entry.last_name })}
        photoUrl={photoUrl}
      />
      <p className="min-w-0 flex-1 truncate text-[15px] leading-5 font-semibold tracking-[-0.01em]">
        {name}
      </p>
    </Link>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="flex flex-col items-center gap-2.5 rounded-[26px] border border-dashed px-6 py-8 text-center"
      style={{ borderColor: "rgba(13,18,32,.16)", background: "rgba(255,255,255,.45)" }}
    >
      <p className="text-[14px] leading-[19px] font-semibold">{title}</p>
      <p
        className="max-w-[40ch] text-[13px] leading-[19px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        {body}
      </p>
    </div>
  );
}
