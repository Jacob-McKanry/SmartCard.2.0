/**
 * The exact words both remove-connection controls use — the meeting record's
 * (`[connectionId]/remove-connection.tsx`) and Activity's
 * (`../../activity/remove-connection-inline.tsx`).
 *
 * WHY ONE MODULE RATHER THAN TWO SETS OF STRINGS
 *
 * The two controls call different Server Actions (one re-renders the record,
 * the other re-renders the Activity list) but perform the *same* one-way
 * database transition with the same effects. `docs/design/DESIGN.md` §7
 * requires the confirmation step to name those effects individually, and two
 * independently-maintained descriptions of one irreversible action is how one
 * of them ends up quietly wrong. Sharing the copy makes that impossible.
 *
 * EVERY LINE IS CHECKED AGAINST WHAT ACTUALLY HAPPENS — no line here is a
 * guess about the database, which is the whole point of writing them down
 * once:
 *  - the edge flips `active -> removed`, so it leaves both people's lists;
 *  - the `users` select policy's `are_connected` branch stops matching, so
 *    neither profile resolves for the other any more (§3.4);
 *  - nothing deletes the `meetings` row, and `connections.origin_meeting_id`
 *    is `ON DELETE RESTRICT` (§2.3), so the record genuinely does stay;
 *  - there is no grant anywhere for `removed -> active`
 *    (`20260809211200_rls_policies_graph_and_meetings.sql`), and no service
 *    function that could ask for one — see `removeConnection`'s header.
 */
export function removalConsequences(otherName: string): readonly string[] {
  return [
    `${otherName} leaves your People list, and you leave theirs.`,
    `Neither of you can see the other's profile after this.`,
    `The meeting record stays in your history — nothing about it is shared any further.`,
    `There is no undo and no reconnect button. Connecting again means being in the same place again, in person.`,
  ];
}

/**
 * The revoke-card counterpart, for Activity.
 *
 * The last line is deliberately not "this is permanent": the RLS policy
 * behind `revokeCard` does permit an owner to un-revoke their own card
 * (`revoked -> assigned`), so claiming the database forbids it would be
 * false. What is true is that this app ships no restore action, which is what
 * the line says — §7's "never invent a capability" cuts both ways, and
 * overstating permanence is still describing the system inaccurately.
 */
export function revokeCardConsequences(cardCode: string): readonly string[] {
  return [
    `Card ${cardCode} stops working immediately — tapping it will do nothing.`,
    `Nobody can use it to connect, including you.`,
    `Connections it already made are unaffected; they stay exactly as they are.`,
    `It disappears from this list, and there is no restore button in the app.`,
  ];
}
