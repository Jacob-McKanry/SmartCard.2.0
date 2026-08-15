"use server";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import {
  getConnectionForViewer,
  getMeetingLocation,
  getMeetingRecord,
  getOtherParticipantProfile,
} from "@/server/connections/connections-service";
import { signedProfilePhotoUrl } from "@/server/profile/photo-url";

import { displayName, initialsFor } from "../connections/lib/format";

/**
 * What the "you're connected" payoff shows about the person you just met.
 *
 * WHY THIS EXISTS AT ALL
 *
 * `docs/design/DESIGN.md` §6 specifies the Connect success screen as the
 * biggest moment in the app: the two people's rings settle, a checkmark
 * springs in, and then **their name**, `VERIFIED IN PERSON`, and **place ·
 * time**. `POST /api/connect/qr/redeem` returns two ids and nothing else
 * (`connectRedeemResponseSchema`), on purpose — that endpoint answers a
 * stranger holding a token, so it says as little as possible. The scanner
 * therefore lands on the payoff knowing a `connectionId` and no words to put
 * on the screen.
 *
 * WHY THIS IS NOT A NEW HOLE IN THE CONNECT SURFACE
 *
 * Read the four calls below: they are exactly the calls
 * `/connections/[connectionId]/page.tsx` already makes, in the same order,
 * through the same RLS-bound client. This exposes a strict subset of a page
 * the same caller can already open by following the link this payoff renders.
 * Specifically:
 *
 *  - **No new query and no new grant.** Every function here already existed
 *    and is used by the meeting-record page. Nothing was added to
 *    `connections-service.ts`, no policy was written, and the service-role
 *    client is not reachable from this file.
 *  - **`connectionId` is not trusted.** It is a client-supplied string, and
 *    it is treated as one: `getConnectionForViewer` resolves it through the
 *    caller's own client, whose `connections` select policy returns nothing
 *    unless the caller is a party to that edge. Passing somebody else's id
 *    returns `null`, the same as passing a made-up one — see that function's
 *    header on why those two cases are deliberately indistinguishable.
 *  - **`null` is the answer to every doubt.** Not found, not yours,
 *    structurally odd, or thrown — all produce `null`, and the payoff simply
 *    renders without a name. Fail closed: a connect screen must never invent
 *    the identity of the person it says you just met.
 *  - **It reveals nothing about a refusal.** This is only ever called after
 *    the API already answered `ok: true`. It is not reachable from, and tells
 *    nothing about, a rejected scan — §4.2 step 7's rule is untouched.
 *
 * WHY THE TIME IS NO LONGER FORMATTED HERE
 *
 * It used to be, so that the payoff and the meeting record it links to could
 * not word the same instant two different ways. They did agree — and both were
 * wrong: this is server code, and `toLocaleTimeString` with no `timeZone` uses
 * the Vercel runtime's zone, so a 10:00 PM connection congratulated you on
 * meeting someone at 4:00 AM. The raw `timestamptz` goes to the client now and
 * `<LocalTimestamp>` renders it there, which is the only place the reader's
 * zone is known. The two screens still agree, because they now share the one
 * component rather than two copies of the same formatting call.
 */
export interface ConnectPayoffDetails {
  name: string;
  initials: string;
  photoUrl: string | null;
  /** `meeting_locations.place_label`, or null when no location was captured. */
  placeLabel: string | null;
  /**
   * `meetings.occurred_at`, raw. Rendered time-of-day only — the meeting is
   * seconds old, so the date would be noise.
   */
  occurredAt: string;
}

export async function loadConnectPayoff(
  connectionId: string,
): Promise<ConnectPayoffDetails | null> {
  try {
    const context = await getAuthenticatedContext();
    if (context === null) return null;

    const { supabase, userId } = context;

    const connection = await getConnectionForViewer(supabase, connectionId);
    if (connection === null) return null;

    const otherUserId =
      connection.user_a_id === userId ? connection.user_b_id : connection.user_a_id;

    const [meeting, location, otherUser] = await Promise.all([
      getMeetingRecord(supabase, connection.origin_meeting_id),
      getMeetingLocation(supabase, connection.origin_meeting_id),
      getOtherParticipantProfile(supabase, otherUserId),
    ]);

    if (meeting === null || otherUser === null) return null;

    return {
      name: displayName(otherUser),
      initials: initialsFor(otherUser),
      photoUrl: await signedProfilePhotoUrl(supabase, otherUser.photo_path),
      placeLabel: location?.place_label ?? null,
      occurredAt: meeting.occurred_at,
    };
  } catch {
    // See the header: every doubt resolves to "no details", never to a
    // partially-populated payoff or a thrown error on a screen that is
    // celebrating a connection that genuinely was made.
    return null;
  }
}
