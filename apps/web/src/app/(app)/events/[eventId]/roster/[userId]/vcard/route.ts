import { getAuthenticatedContext } from "@/server/auth/current-user";
import { getAttendeeProfile, loadAttendeePhotoForVCard } from "@/server/events/roster-service";
import { vCardRefusalResponse, vCardResponse } from "@/server/cards/vcard";

/**
 * `GET /events/[eventId]/roster/[userId]/vcard` — "Save to contacts" on the
 * roster's attendee profile.
 *
 * UNLIKE `/card/[code]/vcard`, THIS ENDPOINT REQUIRES REAL AUTH. That
 * template route is deliberately open, because a signed-in visitor who taps
 * a physical card is about to be connected to its owner and can already see
 * everything the file would contain. Nothing analogous is true here: the
 * whole roster surface exists only for signed-in fellow attendees of one
 * specific event, so this route re-derives the caller with
 * `getAuthenticatedContext()` and refuses (the same indistinguishable
 * refusal as everything else on this surface) rather than serving anyone
 * who guesses the URL.
 *
 * INDEPENDENTLY REACHABLE, SO IT RE-RESOLVES EVERYTHING. It does not trust
 * that the profile page rendered first — it calls `event_attendee_profile`
 * itself, with `p_for_save: true`, so the full authorization chain (roster
 * membership both ways, opt-in, live/not-cancelled, budget) runs again and
 * the SAVES budget/log entry is the one spent, distinct from the profile
 * page's own OPEN. See `event_attendee_profile`'s own header for why one RPC
 * serves both moments.
 *
 * EVERYTHING IS INSIDE ONE TRY/CATCH, RESOLVING TO THE SAME REFUSAL.
 * `getAuthenticatedContext()` can throw for a handful of genuinely abnormal
 * session states (`(app)/layout.tsx`'s "THE GATE CAN ALSO FAIL" note), and
 * `getAttendeeProfile` throws on a real transport or shape failure. A page
 * can catch those and explain; a download endpoint has no such surface, and
 * this file's whole point is that a refusal carries no reason — so every
 * failure here, expected or not, becomes the identical response a stranger
 * gets for guessing the URL.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string; userId: string }> },
): Promise<Response> {
  try {
    const context = await getAuthenticatedContext();
    if (context === null) {
      return vCardRefusalResponse();
    }
    const { supabase } = context;
    const { eventId, userId } = await params;

    const profile = await getAttendeeProfile(supabase, eventId, userId, true);
    if (profile === null) {
      return vCardRefusalResponse();
    }

    const photo = await loadAttendeePhotoForVCard(supabase, profile.photoPath);

    return vCardResponse({
      firstName: profile.firstName,
      lastName: profile.lastName,
      companyName: profile.companyName,
      companyRole: profile.companyRole,
      bio: profile.bio,
      phoneNumber: profile.phoneNumber,
      email: profile.email,
      photo,
      socialLinks: profile.socialLinks,
    });
  } catch (error) {
    console.error("[events/roster/vcard] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return vCardRefusalResponse();
  }
}
