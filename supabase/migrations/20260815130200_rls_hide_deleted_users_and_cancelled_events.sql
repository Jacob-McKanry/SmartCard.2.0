-- =============================================================================
-- 20260815130200_rls_hide_deleted_users_and_cancelled_events.sql
--
-- WHAT THIS CHANGES
--   Two visibility rules, so that "deleted" and "cancelled" mean something to
--   every reader in the database rather than to whichever screen remembered to
--   filter:
--
--     1. `public.users` select policy — a `deleted` account is no longer
--        readable by its connections or its co-attendees. You can still always
--        read yourself.
--     2. `private.can_see_event()` — a `cancelled` event is no longer visible
--        through the "any authenticated user may see a public event" branch. It
--        stays visible to its host, to everyone holding an RSVP row for it, and
--        to everyone holding an invite.
--
--   No grants change. No table changes. Both rules NARROW what is readable; no
--   caller can see anything after this migration that they could not see before.
--
-- ===========================================================================
-- 1. WHY THE `users` POLICY IS BEING TOUCHED AT ALL
-- ===========================================================================
--   20260809211100 calls its own `users` select policy "the most important
--   policy file in the project", and says outright that reintroducing search
--   "would require consciously weakening this policy in a reviewed migration,
--   which is the point". This is that kind of migration in reverse: a conscious,
--   reviewed, STRICTLY NARROWING amendment, recorded here and cross-referenced
--   from there.
--
--   It is needed because self-serve account deletion (20260815130300) is a soft
--   delete, and a soft delete that leaves you readable is a setting, not a
--   deletion. Before this migration, `status` had no effect on RLS anywhere:
--   `private.current_user_id()` is deliberately a thin wrapper over `auth.uid()`
--   with no table access (20260809210900 explains why, and that reasoning is
--   unchanged), and account status was enforced only at the point tokens are
--   minted, in `ensureUser()`. That placement is right for AUTHENTICATION — a
--   suspended or deleted person should never receive a Supabase JWT — but it
--   says nothing about whether OTHER people can still read their row. They
--   could. A deleted member would have stayed in their connections' lists, in
--   their feed, and on the events they had answered for, indefinitely.
--
--   What is emphatically NOT done here: `current_user_id()` is not changed, and
--   no policy reads `users` to answer a question about a different table. The
--   filter is a plain column test inside the `users` policy itself, where the
--   row is already in hand — it costs nothing and cannot recurse.
--
-- WHY `status <> 'deleted'` AND NOT `status = 'active'`
--   Because `suspended` is a different thing and hiding it was not asked for and
--   is not obviously right. A suspension is a hold placed on the ACCOUNT HOLDER
--   — they cannot start a session — and it is usually temporary and often
--   administrative. It is not a statement to the people they have met that they
--   no longer exist, and blanking a suspended person out of a friend's
--   connection list would leak the fact of a moderation action to third parties.
--   Deletion is the opposite: it is the person's own decision that they should
--   stop appearing. So the test names the state it means.
--
-- WHY THE `self` BRANCH IS LEFT UNFILTERED
--   `id = current_user_id()` keeps working whatever your status is. Today this
--   is unreachable — a deleted account cannot obtain a Supabase JWT, so there is
--   no session for the branch to serve — and it is left open anyway, because the
--   alternative fails in the worse direction: a screen that ever needs to tell
--   somebody something about their own deleted or suspended account (the auth
--   failure screen, an admin-facing restore tool, a support view) would find its
--   own row unreadable and could not even say whose account it was. A person
--   reading their own row learns nothing they did not already know.
--
-- WHAT THIS MEANS FOR SCREENS, IN PLAIN LANGUAGE
--   Every list in this app that shows other people is built as "read the rows I
--   am entitled to, then look those people up" — `listOwnConnections`,
--   `feed-service`, `activity-service` — and every one of them already skips a
--   row whose person did not come back, because the FK constraints made that
--   "structurally impossible" and the code failed closed anyway. Those
--   fail-closed branches stop being theoretical with this migration: they are
--   now the mechanism by which a deleted person leaves the product. The comments
--   that describe them as impossible states have been updated in the same
--   change, per CLAUDE.md's rule about not leaving documentation stale.
--
--   The connection ROW is untouched. `connections.status` stays `active` and
--   nothing here removes an edge, for a specific reason: the `active -> removed`
--   transition is one-way at the database layer (20260809211200 refuses the
--   reverse, because restoring an edge would be a live connection with no fresh
--   verification behind it). Removing connections on delete would therefore make
--   the delete IRREVERSIBLE in the one dimension that matters most, which is
--   exactly what a soft delete must not be. Hiding the person is reversible;
--   dissolving their graph is not.
--
-- ===========================================================================
-- 2. WHY A CANCELLED EVENT LEAVES THE PUBLIC BRANCH BUT NOTHING ELSE
-- ===========================================================================
--   The project owner's decision, stated as a rule: attendees must not find that
--   an event they answered for silently vanished, and strangers must not be
--   shown an event that is not happening.
--
--   `private.can_see_event()` already has exactly the right shape to express
--   that, because its branches already distinguish "anybody" from "you have a
--   relationship to this event". Only the first branch is narrowed:
--
--     e.visibility = 'public'  ->  e.visibility = 'public' and e.status <> 'cancelled'
--
--   The host branch, the RSVP branch and the invite branch are untouched, so
--   everyone who had answered — `going`, `interested`, `pending`, `waitlist`,
--   `denied`, any of them — keeps seeing the event and reads "Cancelled" on it.
--   Browse, which is the "anybody" surface, stops listing it: `browseEvents`
--   filters `visibility = 'public'` and the policy now refuses the row, so no
--   application query had to change for the rule to take effect. That is the
--   point of putting it here rather than in a `.eq()`.
--
--   Note the one consequence worth naming: for a PRIVATE event, cancellation
--   changes nothing about visibility, because a private event was never visible
--   through the public branch in the first place. Its audience is defined
--   entirely by RSVP and invite rows, and those people keep it. Correct, but not
--   obvious from the diff.
--
-- ACCESS GRANTED / FORBIDDEN, SUMMARISED
--   GRANTED: nothing. This migration hands nobody a row they did not have.
--   FORBIDDEN, newly:
--     * reading a `deleted` user's row via the connection or co-attendee branch,
--       for every `authenticated` caller including admins (`is_admin` has no
--       policy branch anywhere in this schema and does not get one here).
--     * seeing a `cancelled` public event without a host/RSVP/invite
--       relationship to it, for every `authenticated` caller.
--   `anon` still has no grant on either table and is unaffected.
--   The service role still bypasses both, which is what lets
--   `card-preview-service.ts` read a deleted owner's row in order to REFUSE the
--   disclosure — see the note at the end of this file.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users — a deleted account is not readable through the graph
-- ---------------------------------------------------------------------------
-- Replaced rather than `alter policy ... using (...)`, so the whole rule appears
-- in one place in this file and a reviewer never has to reconstruct the final
-- expression from an original and a patch.
drop policy "read self, connections, and co-attendees only" on public.users;

create policy "read self, connections, and co-attendees only"
on public.users for select to authenticated using (
  id = (select private.current_user_id())
  or (
    -- Amended 20260815130200: both relationship branches now require the
    -- subject to still exist as far as the product is concerned. `users.status`
    -- is a column on the row being tested, so this adds no lookup and cannot
    -- recurse into this policy.
    users.status <> 'deleted'
    and (
      (select private.are_connected(private.current_user_id(), users.id))
      or (select private.shares_event_with(private.current_user_id(), users.id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- can_see_event — cancelled events leave the "anybody" branch
-- ---------------------------------------------------------------------------
-- Restated in full (the third revision of this function: 20260809210900 wrote
-- it, 20260814060100 added the invite branch, this adds the cancellation test).
-- Every other line is byte-for-byte the previous version.
create or replace function private.can_see_event(viewer uuid, p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select viewer is not null
     and p_event_id is not null
     and exists (
       select 1
       from public.events e
       where e.id = p_event_id
         and (
           -- Amended 20260815130200. The only branch that is true for an
           -- arbitrary authenticated caller is also the only branch a
           -- cancellation should close: a cancelled event is not a thing for
           -- strangers to find, but the people who answered for it are owed the
           -- news rather than a disappearance.
           (e.visibility = 'public' and e.status <> 'cancelled')
           or e.host_user_id = viewer
           or exists (
             select 1
             from public.event_rsvps r
             where r.event_id = e.id
               and r.user_id = viewer
           )
           or exists (
             select 1
             from public.event_invites i
             where i.event_id = e.id
               and i.invited_user_id = viewer
           )
         )
     );
$$;

comment on function private.can_see_event(uuid, uuid) is
  'Whether a viewer may see an event: public events that are not cancelled to any '
  'authenticated user (deliberate exception, §2.6, narrowed by 20260815130200), '
  'plus — cancelled or not — the host, anyone holding an RSVP row, and anyone '
  'holding an event_invites row. A cancelled event therefore leaves browse but '
  'stays in front of the people who were counting on it.';

-- =============================================================================
-- A NOTE ON THE TWO READERS THIS POLICY DOES NOT REACH, SO NEITHER IS MISTAKEN
-- FOR AN OVERSIGHT
--
--   1. `apps/web/src/server/cards/card-preview-service.ts` holds the service
--      role and therefore reads a deleted owner's `users` row regardless of this
--      policy. That is not a hole; it is how the refusal works. The module
--      selects `status` for exactly this purpose and returns `null` for any
--      owner who is not `active`, and its header explains why every refusal on
--      that path has to be indistinguishable. The soft delete additionally
--      revokes the person's cards (20260815130300), so the disclosure is refused
--      twice over, at the card and at the owner.
--
--   2. `social_links` is NOT narrowed, although its select policy is written to
--      mirror the `users` one exactly ("social links are profile content, so
--      they are gated by exactly the rule that gates the profile"). Two reasons,
--      and if either stops holding this should be revisited in a migration of
--      its own. First, nothing reads another person's links through RLS —
--      `listOwnSocialLinks` is filtered to the caller, and the only other reader
--      in the product is the card preview, which holds the service role and
--      refuses a non-active owner before it gets that far. Second, the mirror
--      would not be a column test: `social_links` has no `status`, so the policy
--      would have to join `users` on every row, which is real cost for a case
--      that is currently unreachable. What is reachable is a future screen that
--      renders a connection's links; the day one exists, this exemption ends.
--
--   3. `private.are_connected()` and `private.shares_event_with()` still answer
--      about deleted people. They are asked "is there an edge" and "is there a
--      shared event", and both remain true facts — the edge and the RSVP rows
--      are still there, deliberately, so the delete stays reversible. What
--      changed is that being connected to somebody is no longer sufficient to
--      READ them. Pushing the status test down into those helpers instead was
--      considered and rejected: they are used to decide access to meetings,
--      locations and social links as well, and a deleted person's own
--      participation facts should not start evaluating differently in rules that
--      are not about displaying them.
-- =============================================================================
