import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";
import {
  getConnectionForViewer,
  getMeetingLocation,
  getMeetingParticipants,
  getMeetingRecord,
  getOtherParticipantProfile,
} from "@/server/connections/connections-service";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { displayName, formatOccurredAt, initialsFor, verificationMethodLabel } from "../lib/format";
import { deriveLocationSharingStatus } from "./location-sharing";
import { LocationControls } from "./location-controls";
import { RemoveConnection } from "./remove-connection";

/**
 * The meeting-record view for one connection (README build order item 3;
 * task doc §"A meeting-record view"). This is the first screen to touch the
 * location-consent mechanic, so read this alongside
 * `20260809211200_rls_policies_graph_and_meetings.sql` before changing it —
 * every value rendered below is fetched, not assumed, and every control maps
 * to exactly one column-level UPDATE grant in that migration (see the build
 * report for the mapping table).
 *
 * WHY THIS RENDERS EVEN A `removed` CONNECTION, JUST WITHOUT CONTROLS
 *
 * The `connections` select policy has no status filter — a participant can
 * always read their own edge, active or removed (this is what makes
 * "confirm the removal happened" possible at all). Rather than 404 a
 * just-removed connection's old URL, this page shows the historical meeting
 * record and drops the mutation controls, since there is nothing left to
 * manage: `removeConnectionAction` already redirects back to `/connections`
 * on the happy path, so reaching this branch means the URL was revisited or
 * bookmarked afterward.
 *
 * WHY A MISSING CONNECTION 404s INSTEAD OF SHOWING AN ERROR
 *
 * `getConnectionForViewer` returns `null` for both "no such connection" and
 * "exists, but you're not a party to it" — see that function's comment for
 * why those two cases are deliberately indistinguishable. Either way, a
 * generic 404 is the right response: it says nothing about which case it
 * was, which is the same posture the connect flow takes toward rejections
 * (§4.2 step 7 — never confirm or deny specifics to someone not entitled to
 * them).
 */
export const dynamic = "force-dynamic";

export default async function ConnectionDetailPage({
  params,
}: {
  params: Promise<{ connectionId: string }>;
}) {
  const { connectionId } = await params;
  const context = await getAuthenticatedContext();

  if (context === null) {
    redirect("/sign-in");
  }

  const { supabase, userId } = context;

  const connection = await getConnectionForViewer(supabase, connectionId);
  if (connection === null) {
    notFound();
  }

  const otherUserId = connection.user_a_id === userId ? connection.user_b_id : connection.user_a_id;

  const [meeting, participants, location, otherUser] = await Promise.all([
    getMeetingRecord(supabase, connection.origin_meeting_id),
    getMeetingParticipants(supabase, connection.origin_meeting_id),
    getMeetingLocation(supabase, connection.origin_meeting_id),
    getOtherParticipantProfile(supabase, otherUserId),
  ]);

  // `meetings.id` is NOT NULL/UNIQUE-referenced by `connections.origin_meeting_id`
  // with ON DELETE RESTRICT (§2.3), and the `users` policy already let this
  // connection's row resolve to `otherUserId` in the first place — so a null
  // here means something is structurally wrong, not that access was denied.
  // Failing closed with a 404 either way, rather than crashing the page.
  if (meeting === null || otherUser === null) {
    notFound();
  }

  const viewerParticipant = participants.find((p) => p.user_id === userId) ?? null;
  const otherParticipant = participants.find((p) => p.user_id === otherUserId) ?? null;
  if (viewerParticipant === null || otherParticipant === null) {
    notFound();
  }

  const otherName = displayName(otherUser);
  const photoUrl = await signedProfilePhotoUrl(supabase, otherUser.photo_path);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 p-6 sm:p-10">
      <div>
        <Link href="/connections" className="text-sm text-muted-foreground hover:underline">
          &larr; Your connections
        </Link>
      </div>

      <header className="flex items-center gap-4">
        <Avatar className="size-14">
          <AvatarImage src={photoUrl ?? undefined} alt="" />
          <AvatarFallback>{initialsFor(otherUser)}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-2xl font-semibold">{otherName}</h1>
          <p className="text-sm text-muted-foreground">
            {connection.status === "removed" ? "Connection removed" : "Active connection"}
          </p>
        </div>
      </header>

      <section aria-labelledby="meeting-heading" className="flex flex-col gap-2">
        <h2 id="meeting-heading" className="text-sm font-medium text-muted-foreground">
          How you connected
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Who</dt>
          <dd>You and {otherName}</dd>
          <dt className="text-muted-foreground">When</dt>
          <dd>{formatOccurredAt(meeting.occurred_at)}</dd>
          <dt className="text-muted-foreground">How</dt>
          <dd>{verificationMethodLabel(meeting.verification_method)}</dd>
        </dl>
      </section>

      {connection.status === "removed" ? (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          You removed this connection. Its meeting record stays visible to you as history, but there
          is nothing left to manage here — reconnecting means meeting {otherName} in person again.
        </p>
      ) : (
        <>
          <section aria-labelledby="location-heading" className="flex flex-col gap-2">
            <h2 id="location-heading" className="text-sm font-medium text-muted-foreground">
              Location
            </h2>
            {location === null ? (
              <p className="text-sm text-muted-foreground">
                {meeting.verification_method === "nfc_card"
                  ? "No location was recorded for this meeting — an NFC tap proves you were close enough by physical range, so it doesn't need GPS."
                  : "No location was recorded for this meeting."}
              </p>
            ) : (
              <>
                <p className="text-sm">{location.place_label ?? "Location captured, no place name on file."}</p>
                <p className="text-sm text-muted-foreground">
                  Private to you and {otherName} by default. Nobody else — including mutual
                  connections — can see this unless you both choose to share it below.
                </p>
                <LocationControls
                  meetingId={meeting.id}
                  connectionId={connection.id}
                  otherName={otherName}
                  locationVisibility={meeting.location_visibility}
                  viewerConsent={viewerParticipant.location_share_consent}
                  otherConsent={otherParticipant.location_share_consent}
                  viewerMarkedPrivate={viewerParticipant.marked_private}
                  otherMarkedPrivate={otherParticipant.marked_private}
                  sharingStatus={deriveLocationSharingStatus({
                    locationVisibility: meeting.location_visibility,
                    viewerConsent: viewerParticipant.location_share_consent,
                    otherConsent: otherParticipant.location_share_consent,
                    hiddenByPrivacyOverride:
                      meeting.is_private ||
                      viewerParticipant.marked_private ||
                      otherParticipant.marked_private,
                  })}
                />
              </>
            )}
          </section>

          <section aria-labelledby="danger-heading" className="flex flex-col gap-2 border-t border-border pt-6">
            <h2 id="danger-heading" className="text-sm font-medium text-muted-foreground">
              Remove connection
            </h2>
            <RemoveConnection connectionId={connection.id} otherName={otherName} />
          </section>
        </>
      )}
    </main>
  );
}
