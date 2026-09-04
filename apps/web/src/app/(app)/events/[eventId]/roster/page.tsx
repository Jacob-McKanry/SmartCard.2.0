import { notFound, redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { getEventForViewer, getOwnRsvp } from "@/server/events/events-service";
import { listOwnAttendedEventIds } from "@/server/events/attended-events-service";
import { listEventRoster } from "@/server/events/roster-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";

import { canViewRoster, viewerRole } from "../../lib/access-rules";
import { hasStarted } from "../../lib/format";
import { RosterView } from "./roster-view";

/**
 * `/events/[eventId]/roster` — the one bounded people-listing surface
 * `docs/architecture/2026-08-27-event-attendee-roster.md` carves out of
 * CLAUDE.md's "no attendee list" rule. Opted-in attendees of a *started*
 * event may see each other here; nobody else, and nobody before the event
 * begins.
 *
 * THREE GATES, THE SAME SHAPE `queue/page.tsx` USES AND FOR THE SAME REASON
 *
 *  1. `public.event_roster` refuses on its own — empty set, not an error —
 *     for a non-member, a not-yet-started event, a cancelled one, or a
 *     rate-limited caller. That is the real enforcement; nothing below is a
 *     security boundary.
 *  2. This page's own `canViewRoster(...)` → `notFound()`. Routing hygiene,
 *     not access control: a genuine attendee still sees the friendly "not
 *     yet" state below rather than a 404 (see the next paragraph), but a
 *     stranger to a private event gets exactly the same 404 as one who
 *     mistyped the URL.
 *  3. `RosterView` repeats the check, so the rule is testable as a rule —
 *     `access-rules.test.tsx`'s own convention for this feature.
 *
 * WHY A NOT-YET-STARTED EVENT IS A FRIENDLY EMPTY STATE HERE, NOT `notFound()`
 * — A DELIBERATE DEPARTURE FROM `queue/`'s OWN PATTERN
 *
 * `queue/page.tsx` 404s a non-host because a management screen that renders
 * empty to a stranger looks broken and invites poking at it. That reasoning
 * does not carry over here: "the roster opens once the event starts" is an
 * everyday, expected state for a legitimate attendee — not a routing
 * accident — so it gets its own explanatory copy instead of a 404. The page
 * decides which explanation to show from `event.starts_at`/`status` read
 * directly, rather than trying to infer a reason from `event_roster`'s
 * necessarily-indistinguishable empty result (§3.6): a `[]` from the RPC
 * might just as well mean "started, nobody's opted in yet", which is drawn
 * as the ordinary empty roster, not a refusal.
 */
export const dynamic = "force-dynamic";

/** Same module-scope-clock-read reasoning as `[eventId]/page.tsx`'s `eventHasEndedNow`. */
function eventHasStartedNow(startsAt: string): boolean {
  return hasStarted(startsAt, Date.now());
}

export default async function EventRosterPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }
  const { supabase, userId } = context;
  const { eventId } = await params;

  const item = await getEventForViewer(supabase, eventId);
  if (item === null) {
    notFound();
  }
  const { event } = item;

  const [ownRsvp, attendedEventIds] = await Promise.all([
    getOwnRsvp(supabase, event.id, userId),
    listOwnAttendedEventIds(supabase),
  ]);
  const role = viewerRole(event.host_user_id, userId, ownRsvp);
  const wasClaimedGuest = attendedEventIds.has(event.id);

  if (!canViewRoster(role, wasClaimedGuest)) {
    // Gate 2 — see the header. Same answer as an event that does not exist.
    notFound();
  }

  const isCancelled = event.status === "cancelled";
  const started = eventHasStartedNow(event.starts_at);

  // Mirrors `event_roster`'s own gate (§3.2: live, non-cancelled only) so the
  // page never makes a round trip the RPC would refuse anyway.
  const entries = started && !isCancelled ? await listEventRoster(supabase, event.id) : [];

  const photoEntries = await Promise.all(
    entries.map(
      async (entry) => [entry.user_id, await signedProfilePhotoUrl(supabase, entry.photo_path)] as const,
    ),
  );

  return (
    <RosterView
      role={role}
      wasClaimedGuest={wasClaimedGuest}
      eventId={event.id}
      eventTitle={event.title}
      isCancelled={isCancelled}
      hasStarted={started}
      entries={entries}
      photoUrls={Object.fromEntries(photoEntries)}
    />
  );
}
