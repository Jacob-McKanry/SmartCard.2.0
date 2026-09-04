import { notFound, redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { getEventForViewer } from "@/server/events/events-service";
import { getAttendeeProfile } from "@/server/events/roster-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";

import { AttendeeProfileView } from "./attendee-profile-view";

/**
 * `/events/[eventId]/roster/[userId]` — one opted-in attendee's card, opened
 * from the roster (`../roster-view.tsx`).
 *
 * ONE RPC IS THE WHOLE GATE. `event_attendee_profile` re-derives every check
 * itself — caller is a roster member of this event, subject is too, subject
 * is opted in, event is live, caller is under budget — and refuses all of
 * them the same indistinguishable way (§3.6): `{available: false}`, which
 * `getAttendeeProfile` turns into `null`. There is nothing else this page
 * could check that would be more authoritative, so a `null` result is
 * `notFound()` and nothing further is inferred from *why*.
 *
 * `p_for_save` STAYS `false` HERE. Rendering this page spends the OPEN
 * budget/log entry; the vCard route (`[userId]/vcard/route.ts`) calls the
 * same RPC again with `p_for_save: true` immediately before building the
 * file, spending the separate SAVE budget — see `event_attendee_profile`'s
 * own header for why one RPC serves both moments.
 */
export const dynamic = "force-dynamic";

export default async function RosterAttendeeProfilePage({
  params,
}: {
  params: Promise<{ eventId: string; userId: string }>;
}) {
  const context = await getAuthenticatedContext();
  if (context === null) {
    redirect("/sign-in");
  }
  const { supabase } = context;
  const { eventId, userId } = await params;

  // Confirms the event itself exists and is visible to this caller before
  // spending an open on a profile that could not be reached anyway — the
  // same "does the container exist" check every event sub-route makes.
  const item = await getEventForViewer(supabase, eventId);
  if (item === null) {
    notFound();
  }

  const profile = await getAttendeeProfile(supabase, eventId, userId, false);
  if (profile === null) {
    notFound();
  }

  const photoUrl = await signedProfilePhotoUrl(supabase, profile.photoPath);

  return (
    <AttendeeProfileView
      eventId={eventId}
      eventTitle={item.event.title}
      userId={userId}
      profile={profile}
      photoUrl={photoUrl}
    />
  );
}
