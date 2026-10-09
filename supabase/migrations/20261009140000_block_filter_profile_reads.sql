-- =============================================================================
-- 20261009140000_block_filter_profile_reads.sql
--
-- THIS IS THE DELIBERATE AMENDMENT 20260809211100 SAID WOULD BE NEEDED.
--   That file's header, under "WHAT IS DELIBERATELY ABSENT", reads:
--
--     "No block filtering in the users select policy. §3.4's policy does not
--      include one, and blocks are enforced where they matter — at connection
--      time (§4.2 step 5.7, §4.5 step 4). Q4 (is block/report in pilot
--      scope?) is still open; if the answer is yes and blocking should also
--      hide profiles, that is a deliberate amendment to this policy, not
--      something to slip in here."
--
--   Q4 is now answered yes (owner decision 4,
--   `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`; Q4's row
--   in the 2026-08-09 proposal records the resolution), including "blocking is
--   applied broadly — across ... the app's existing feed/roster/profile read
--   paths". This migration is that amendment, made in the open, in its own
--   reviewed file. Part 3 of 5 of the amendment's Phase 2; the roster
--   (20261009140100) and the feed (20261009140200) follow in their own files
--   so each read path's change can be reviewed on its own.
--
-- WHAT THIS CHANGES
--   1. The `public.users` SELECT policy ("read self, connections, and
--      co-attendees only") gains `and not private.blocked_either_way(me, them)`
--      on its RELATIONSHIP branch — the branch that admits active connections
--      and roster-visible co-attendees. Rebuilt in full (drop + create, one
--      transaction), as 20260815130200 did, so the whole rule reads in one
--      place.
--   2. `private.can_see_user` — the definition behind the `profile-photos`
--      storage SELECT policy — gains the same condition on its relationship
--      branch, so a blocked person's PHOTO disappears together with their
--      profile row. (20260815130200 / 20260818030000 are the cautionary tale
--      here: the row and the photo are governed by two definitions, and
--      narrowing only one of them left a deleted member's photo fetchable for
--      three days. Both are changed in this one file for that reason.)
--
--   The SELF branch is untouched in both. `id = current_user_id()` /
--   `p_viewer = p_target` still admit you to your own row and photo whatever
--   your block state — a block is about two people, and you are not blocked
--   from yourself.
--
--   No grant changes. `private.blocked_either_way` was created, and granted
--   EXECUTE to `authenticated` (needed because this policy calls it), in
--   20261009130000.
--
-- WHAT A BLOCK NOW MEANS FOR A PROFILE, IN PLAIN LANGUAGE
--   If A blocks B (or B blocks A — the test is symmetric), then from that
--   moment neither can read the other's `users` row or profile photo through
--   any graph relationship: not as connections (block_user also removes the
--   connection, so that branch would be false anyway), and — the case this
--   actually changes — not as people both `going` to the same event with the
--   roster opt-in on. Before this migration, two co-attendees who had blocked
--   each other could still read each other's name, phone, email, bio and
--   photo through `shares_event_with`. That is the concrete exposure being
--   closed: a person who blocked a harasser should not keep handing that
--   harasser their phone number every time they both RSVP to the same event.
--
--   Symmetric on purpose. One-directional hiding ("B can't see A, A can still
--   see B") would let the BLOCKED person infer the block from the asymmetry,
--   and would let a blocker keep watching someone who can no longer see them
--   — the "watcher who can't be watched" shape the live-map amendment's T4
--   refuses everywhere else.
--
-- WHAT IT DOES NOT CHANGE
--   * `private.are_connected` / `private.shares_event_with` stay block-blind.
--     Same reasoning 20260815130200 note 3 gave for keeping them status-blind:
--     they answer "is there an edge / a shared event", which are facts, and
--     other rules (meeting visibility, social links) call them for reasons
--     that are not about displaying a person. The refusal belongs at "may I
--     READ them", which is this policy and `can_see_user`.
--   * `social_links`' SELECT policy is NOT narrowed, although it mirrors this
--     one. Same call 20260815130200 note 2 made for deleted accounts, for the
--     same two reasons: nothing reads another person's links through RLS
--     today (`listOwnSocialLinks` is self-only; the card preview uses the
--     service role; the roster profile RPC is `security definer` and IS
--     block-filtered in 20261009140100), and the day a screen renders a
--     connection's links through RLS, that exemption ends. Recorded here so it
--     is not mistaken for an oversight.
--   * `meeting_locations`' policy is not touched (it is not on this phase's
--     list). Its only non-participant path requires the viewer to be an
--     ACTIVE connection of both parties (`is_mutual_of_both`), and a blocked
--     pair can never hold an active connection: `block_user` removes it in
--     the same transaction, and both connection-writing functions refuse a
--     blocked pair. The feed's meeting visibility is narrowed explicitly in
--     20261009140200.
--   * `suspended` remains readable through the relationship branch, exactly
--     as 20260815130200 decided. Blocking and suspension are independent.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: nothing, to anyone. Both changes are strictly narrowing.
--   Forbids, newly, to every `authenticated` caller (admins included —
--     `is_admin` has no branch in either rule):
--     * SELECT on a `public.users` row through the connection or co-attendee
--       branch when either party has blocked the other;
--     * SELECT on a `profile-photos` object through `can_see_user`'s
--       relationship branch when either party has blocked the other. (The
--       storage policy's OTHER branch, `shares_roster_event_with`, is
--       narrowed identically in 20261009140100, so after both migrations a
--       blocked pair's photos are refused on every branch.)
--   Unchanged: your own row and photo; the service role (card preview,
--   ensureUser) bypasses RLS as before; `anon` still has nothing.
--
-- VERIFIED LIVE in a rolled-back transaction before applying — see the
--   Phase 2 report for the exact scenarios (blocked co-attendees, blocked
--   connections, self-read, unblocked control pair).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. users SELECT policy — fourth revision
-- ---------------------------------------------------------------------------
-- 20260809211100 wrote it, 20260815000820 restated it via can_see_user,
-- 20260815130200 replaced it with the inlined deleted-account test, and this
-- adds the block test. Every other line is byte-for-byte 20260815130200's.
drop policy "read self, connections, and co-attendees only" on public.users;

create policy "read self, connections, and co-attendees only"
on public.users for select to authenticated using (
  id = (select private.current_user_id())
  or (
    users.status <> 'deleted'
    -- Amended 20261009140000 — the deliberate block-filtering amendment named
    -- in 20260809211100. Relationship branch only; the self branch above is
    -- untouched.
    and not (select private.blocked_either_way(private.current_user_id(), users.id))
    and (
      (select private.are_connected(private.current_user_id(), users.id))
      or (select private.shares_event_with(private.current_user_id(), users.id))
    )
  )
);

-- ---------------------------------------------------------------------------
-- 2. private.can_see_user — third revision (behind the profile-photos policy)
-- ---------------------------------------------------------------------------
create or replace function private.can_see_user(p_viewer uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_viewer is not null and p_target is not null and (
    p_viewer = p_target
    or (
      exists (
        select 1 from public.users u
        where u.id = p_target
          and u.status <> 'deleted'
      )
      -- Amended 20261009140000 (block filtering). Relationship branch only.
      and not private.blocked_either_way(p_viewer, p_target)
      and (
        private.are_connected(p_viewer, p_target)
        or private.shares_event_with(p_viewer, p_target)
      )
    )
  );
$$;

comment on function private.can_see_user(uuid, uuid) is
  'Whether p_viewer may read p_target profile: self always; otherwise an active '
  'connection or a shared going RSVP, AND the target is not deleted '
  '(20260818030000), AND neither has blocked the other (20261009140000, the '
  'deliberate block-filtering amendment 20260809211100 anticipated). Backs the '
  'profile-photos storage SELECT policy; the users SELECT policy states the '
  'same rule inline.';
