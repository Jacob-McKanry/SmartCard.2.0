import { notFound, redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import {
  getEventAttendanceCounts,
  getEventForViewer,
  getHostRsvpQueue,
} from "@/server/events/events-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";

import { viewerRole } from "../../lib/access-rules";
import { QueueView } from "./queue-view";

/**
 * `/events/[eventId]/queue` — the host-only approval screen.
 *
 * THREE INDEPENDENT GATES STAND BETWEEN A NON-HOST AND THIS PAGE, ON PURPOSE
 *
 *  1. `public.event_rsvp_queue` returns **no rows** to anybody who is not the
 *     event's host. That is the real enforcement: it derives the caller from the
 *     JWT and never takes an actor as a parameter, so nothing this file does can
 *     make it answer for somebody else. If the two gates below were both deleted
 *     tomorrow, a non-host would still see an empty screen rather than a roster.
 *  2. This page's own `viewerRole(...) !== "host"` → `notFound()`, below. It is
 *     about routing, not access: a management screen that renders empty to a
 *     stranger is a screen that *looks* broken and invites somebody to go
 *     looking for the bug. 404 is also the same answer this route gives for an
 *     event that does not exist, so it does not confirm the id is real.
 *  3. `QueueView` returns `null` for any role but `host`. That is the one the
 *     test suite can actually exercise, and it is why the check is duplicated in
 *     a component rather than left to the page — see its header.
 *
 * Fail closed (CLAUDE.md): the counts read can come back `null` if the event
 * stopped being visible between the two round trips. The screen then renders
 * with no seat figure rather than assuming there is room.
 */
export const dynamic = "force-dynamic";

export default async function EventQueuePage({
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

  const role = viewerRole(item.event.host_user_id, userId, null);
  if (role !== "host") {
    // Gate 2. Same answer as a non-existent event — see the header.
    notFound();
  }

  const [entries, counts] = await Promise.all([
    getHostRsvpQueue(supabase, eventId),
    getEventAttendanceCounts(supabase, eventId),
  ]);

  /*
   * Photos for the people in the queue. `event_rsvp_queue` hands back a
   * `photo_path`, which is an object key in a private bucket rather than a URL,
   * so each one still needs a short-lived signed link minted through the host's
   * own client. A failure degrades to initials — `signedProfilePhotoUrl` returns
   * `null` rather than throwing, and a missing photo is not an error state.
   */
  const photoEntries = await Promise.all(
    entries.map(
      async (entry) => [entry.userId, await signedProfilePhotoUrl(supabase, entry.photoPath)] as const,
    ),
  );

  return (
    <QueueView
      role={role}
      eventId={eventId}
      eventTitle={item.event.title}
      seatsRemaining={counts?.seatsRemaining ?? null}
      entries={entries}
      photoUrls={Object.fromEntries(photoEntries)}
    />
  );
}
