/**
 * Date, time and place formatting for the Events screens.
 *
 * WHY EVENT TIMES RENDER IN THE EVENT'S OWN ZONE
 *
 * An event time is a statement about when to turn up somewhere, and 7pm at the
 * venue is 7pm at the venue wherever you happen to be reading about it. That is
 * the opposite call from `components/local-date-line.tsx`, deliberately, and for
 * the same underlying reason: render whichever clock the fact actually belongs
 * to.
 *
 * WHEN NO ZONE IS STORED, THE TIME SAYS SO
 *
 * `events.timezone` is nullable and `starts_at` alone only pins an instant — it
 * does not say what the clock on the venue's wall read. Guessing a zone is wrong
 * by hours and silently so, and `docs/design/DESIGN.md` §7 forbids a screen
 * implying something it cannot back. A missing (or unparseable) zone therefore
 * renders in UTC and is *labelled* UTC, rather than being passed off as a local
 * time.
 *
 * WHY THIS MODULE EXISTS RATHER THAN LIVING ON EACH SCREEN
 *
 * These helpers were written once for Home (`app/(app)/page.tsx`) and are now
 * needed by browse, detail and the host queue. Home's own header records the
 * codebase's convention that two-line display helpers stay feature-local — that
 * convention is about `displayName`-style trivia, not about this. The zone
 * fallback above is a *rule* (§7), and four copies of a rule is four chances for
 * one of them to start rendering an unlabelled guess. Home now imports from
 * here.
 */

/**
 * The zone an event's times should be rendered in, and whether that zone had to
 * be substituted.
 *
 * `labelled: true` means the caller must show the zone name next to the time —
 * see the header. It is not a styling hint.
 */
export function eventZone(timezone: string | null): { zone: string; labelled: boolean } {
  if (timezone === null || timezone.trim() === "") {
    return { zone: "UTC", labelled: true };
  }
  try {
    // `events.timezone` is a free-text column. A value `Intl` does not
    // recognise throws a `RangeError` mid-render, which would take a whole
    // page down over one badly-stored string.
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return { zone: timezone, labelled: false };
  } catch {
    return { zone: "UTC", labelled: true };
  }
}

/** `AUG` — the date chip's top line. */
export function monthLabel(startsAt: string, timezone: string | null): string {
  return new Date(startsAt)
    .toLocaleDateString("en-US", { month: "short", timeZone: eventZone(timezone).zone })
    .toUpperCase();
}

/** `22` — the date chip's numeral. */
export function dayLabel(startsAt: string, timezone: string | null): string {
  return new Date(startsAt).toLocaleDateString("en-US", {
    day: "numeric",
    timeZone: eventZone(timezone).zone,
  });
}

/** `7:00 PM`, or `7:00 PM UTC` when no usable zone is stored. */
export function timeLabel(startsAt: string, timezone: string | null): string {
  const { zone, labelled } = eventZone(timezone);
  const clock = new Date(startsAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  });
  return labelled ? `${clock} UTC` : clock;
}

/** `Sat, Aug 22 · 7:00 PM` — the one-line "when" a card or hero panel shows. */
export function whenLine(startsAt: string, timezone: string | null): string {
  const { zone } = eventZone(timezone);
  const date = new Date(startsAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: zone,
  });
  return `${date} · ${timeLabel(startsAt, timezone)}`;
}

/**
 * `Blue Bottle · San Francisco`, degrading to just the city.
 *
 * `venue_name` is nullable and an event with no venue named yet is an ordinary
 * state, not a broken one (§7 "absence is often normal"), so it is omitted
 * rather than replaced with a placeholder.
 */
export function whereLine(venueName: string | null, cityName: string): string {
  const venue = venueName?.trim();
  return venue ? `${venue} · ${cityName}` : cityName;
}

/**
 * `askedAtLine` USED TO LIVE HERE. THE QUEUE USES `<LocalTimestamp>` NOW.
 *
 * "When did this person ask?" is a fact about a moment in the reader's day,
 * not about the event's venue, so it is the one timestamp on these screens
 * that does *not* belong in the event's zone — it belongs in the host's. It
 * was formatted with no `timeZone` at all inside a Server Component, which
 * meant the Vercel runtime's UTC: an RSVP that arrived at 10:00 PM read
 * "4:00 AM" to the host who was awake for it.
 *
 * `@/components/local-timestamp` is the shared fix, used by every "when did
 * this happen" timestamp in the app. The event *times* above are untouched and
 * must stay that way — the zone rule in this file's header is the opposite
 * call, made for the opposite reason.
 */

/**
 * Whether an event is over, by the same rule the database uses:
 * `coalesce(ends_at, starts_at) < now()` (`request_event_rsvp`,
 * 20260814051200). An event with no end time is treated as over once it has
 * started, which is the SQL's own reading and must not drift from it — the
 * screens use this to decide whether to offer a "Going" button that the RPC
 * would refuse.
 *
 * Pure in `nowMs` so a caller reads the clock once, outside a render body.
 */
export function hasEnded(startsAt: string, endsAt: string | null, nowMs: number): boolean {
  return new Date(endsAt ?? startsAt).getTime() < nowMs;
}

export function displayName(person: {
  first_name: string | null;
  last_name: string | null;
}): string {
  const full = `${person.first_name?.trim() ?? ""} ${person.last_name?.trim() ?? ""}`.trim();
  return full !== "" ? full : "Someone";
}

export function initialsFor(person: {
  first_name: string | null;
  last_name: string | null;
}): string {
  const first = person.first_name?.trim().charAt(0) ?? "";
  const last = person.last_name?.trim().charAt(0) ?? "";
  const combined = `${first}${last}`.toUpperCase();
  return combined !== "" ? combined : "•";
}
