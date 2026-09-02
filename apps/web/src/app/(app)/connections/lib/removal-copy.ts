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

/**
 * The third destructive action, added 2026-08-15 with self-serve account
 * deletion in Settings.
 *
 * IT LIVES IN THIS MODULE, WHICH IS UNDER `connections/lib/`, FOR THE SAME
 * REASON `confirm-panel.tsx` DOES: both are the app's shared destructive-action
 * furniture rather than anything to do with connections, and Settings imports
 * the panel from here already. Splitting the copy off would mean the one file a
 * reviewer opens to check "does every destructive confirmation name its
 * consequences individually" no longer holds all of them.
 *
 * EVERY LINE BELOW IS CHECKED AGAINST WHAT `public.soft_delete_own_account()`
 * ACTUALLY DOES (20260815130300) — same discipline as the two above, and it
 * matters more here because this is the action a person is most likely to be
 * frightened of:
 *
 *  - `users.status -> 'deleted'`, and the amended `users` select policy
 *    (20260815130200) drops the connection and co-attendee branches for a
 *    deleted row, so the profile genuinely stops resolving for everyone else.
 *  - every `assigned` card of theirs flips to `revoked` in the SAME
 *    transaction, and `card-preview-service.ts` refuses a revoked card and a
 *    non-active owner independently, so `/card/<code>` shows nothing either way.
 *  - every `scheduled` event they host flips to `cancelled`, and
 *    `private.can_see_event` keeps it visible to everyone holding an RSVP or an
 *    invite while dropping it from public browse.
 *  - every `active` presentation session of theirs flips to `revoked`, which is
 *    what makes a QR code on screen stop resolving.
 *  - `connections`, `meetings` and `event_rsvps` are not touched at all.
 *
 * WHY IT DOES NOT SAY "PERMANENT" OR "THIS CANNOT BE UNDONE"
 *
 * Because that would be false, and §7's rule against inventing a capability
 * applies equally to inventing a limitation — the same argument
 * `revokeCardConsequences` records one function up. This is a SOFT delete:
 * `public.restore_deleted_user` exists, it is a single service-role call, and
 * it puts the account and the events this cancelled back. Frightening somebody
 * with a permanence the database does not implement would also, in the one case
 * that matters, be actively harmful: a person who believed it was irreversible
 * would never ask to have it reversed.
 *
 * What the last two lines do instead is say exactly where the line is — nothing
 * is erased, a person with database access can put it back, and the one thing
 * that will not come back on its own is the cards, because the database cannot
 * tell a card this revoked from one the owner revoked after losing it.
 */
/**
 * Fourth and fifth destructive actions, added 2026-09-02 with the host-facing
 * cancel/delete controls on an event's own page. Live here for the same
 * reason the three above do: this module is the app's shared
 * destructive-confirmation copy, not connections-specific machinery.
 *
 * EVERY LINE CHECKED AGAINST `public.cancel_event` (20260902120000):
 *  - `status -> 'cancelled'`, the identical mechanism
 *    `soft_delete_own_account` already uses, so `private.can_see_event`
 *    keeps the event in front of the host and everyone holding an RSVP or an
 *    invite while dropping it from public browse — same behaviour
 *    `deleteAccountConsequences` already describes for that path.
 *  - `event_rsvps` and `event_invites` are not touched at all; only `events`'
 *    own three columns change.
 *  - No un-cancel RPC exists for `cancelled_reason = 'host_cancelled'` —
 *    unlike the account-deletion path, this one really is permanent, so
 *    unlike `deleteAccountConsequences` this DOES say so.
 */
export function cancelEventConsequences(counts: {
  going: number;
  pendingOrWaitlisted: number;
}): readonly string[] {
  const lines: string[] = [];
  if (counts.going > 0) {
    lines.push(
      `${counts.going} ${counts.going === 1 ? "person who" : "people who"} answered going will see it marked cancelled instead of disappearing on them.`,
    );
  }
  if (counts.pendingOrWaitlisted > 0) {
    lines.push(
      `${counts.pendingOrWaitlisted} ${counts.pendingOrWaitlisted === 1 ? "request" : "requests"} waiting on your decision will not be answered.`,
    );
  }
  lines.push("It disappears from public browse immediately.");
  lines.push("This is permanent — there is no un-cancel button in the app.");
  return lines;
}

/**
 * EVERY LINE CHECKED AGAINST `public.delete_draft_event` (20260902120000):
 *  - a real `DELETE`, not a status change — the row is gone, not hidden.
 *  - safe specifically BECAUSE a draft has no `event_rsvps`/`event_invites`
 *    rows to lose: every write path into those tables already requires
 *    `status = 'scheduled'`. That is also why this copy names no "people who
 *    answered" line the way `cancelEventConsequences` does — there cannot be
 *    any.
 */
export function deleteDraftConsequences(): readonly string[] {
  return [
    "The draft is gone completely — not cancelled, deleted. There is nothing to restore.",
    "Nobody ever saw it but you, so nothing changes for anyone else.",
  ];
}

export function deleteAccountConsequences(): readonly string[] {
  return [
    "Your profile stops being visible to everyone you have met. You disappear from their People list.",
    "Every card you own is revoked straight away, and a live QR code stops working. Tapping one of your cards will show nothing about you.",
    "Events you are hosting are cancelled. Everyone who already answered keeps seeing them, marked cancelled, so nobody turns up to something that is not happening.",
    "You are signed out, and you cannot sign in again while the account is deleted.",
    "Nothing is erased. Your profile, your connections and your meeting history are all kept, and an administrator can restore the account — including the events this cancels.",
    "Your cards are the one thing that stays off. If your account is restored, you switch them back on yourself from Activity.",
  ];
}
