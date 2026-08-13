/**
 * Pure classification of one meeting into the two feed post types the product
 * spec allows (architecture doc §2.9, the "exactly two post types" bullet):
 * "You met [Name]" when the viewer was there, "[A] met [B]" when they were
 * not but are a mutual connection of both. No React, no Supabase client, no
 * network — the same "pure logic in its own module" shape as
 * `apps/web/src/app/connections/[connectionId]/location-sharing.ts`, and
 * tested the same adversarial way (README, "Connect Flow landed").
 *
 * WHAT THIS FUNCTION DOES NOT DECIDE
 *
 * It does not decide *whether* the viewer may see the meeting at all — that
 * question is already answered by the time a meeting row reaches this
 * function, because it only ever gets called on rows a query already
 * retrieved through `private.can_see_meeting()` (§3.1/§3.2,
 * `20260809211200_rls_policies_graph_and_meetings.sql`). RLS is the security
 * boundary; this function only decides which of the two allowed *shapes* to
 * render for a row RLS already handed back. Duplicating the graph check here
 * — e.g. re-deriving "is the viewer a mutual of both?" in TypeScript — would
 * create a second copy of authorization logic that could drift from the
 * database's, which is exactly what `private.can_see_meeting` was written as
 * one shared helper to avoid (see that function's comment in
 * `20260809210900_rls_helper_functions.sql`).
 *
 * WHY IT RETURNS `null` FOR ANYTHING OTHER THAN EXACTLY TWO PARTICIPANTS
 *
 * Meetings are pairwise by construction (§2.4's "PAIRWISE ASSUMPTION" note,
 * `20260809210500_table_meetings.sql`) — one presenter, one scanner, always
 * two `meeting_participants` rows. A meeting that doesn't have exactly two is
 * not a shape either feed post can honestly represent: "You met" needs one
 * *other* person, and "[A] met [B]" needs exactly two named people, not a
 * guess about which one or two of a differently-sized list to show. Returning
 * `null` and letting the caller skip the row is the same "fail closed on
 * malformed data" posture `private.meeting_party()` uses (returns null for a
 * missing nth participant rather than guessing).
 */

export type FeedItemKind = "participant" | "mutual";

/**
 * @param participantUserIds The meeting's `meeting_participants.user_id`
 *   values, in any order.
 * @param viewerUserId The signed-in viewer's `users.id`.
 * @returns `"participant"` if the viewer is one of the two participants
 *   (renders "You met [the other one]"); `"mutual"` if the viewer is neither
 *   (renders "[A] met [B]" — safe to render as such only because the caller
 *   only ever passes rows RLS already scoped to mutuals-of-both, see above);
 *   `null` if the input isn't a well-formed pairwise meeting.
 */
export function classifyFeedMeeting(
  participantUserIds: readonly string[],
  viewerUserId: string,
): FeedItemKind | null {
  if (participantUserIds.length !== 2) {
    return null;
  }
  return participantUserIds.includes(viewerUserId) ? "participant" : "mutual";
}
