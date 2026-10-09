-- =============================================================================
-- 20261009130000_blocks_rpc_only_write_path.sql
--
-- WHAT THIS CHANGES
--   Phase 2 of `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`,
--   part 2 of 5: blocking becomes a real user action (owner decision 4 — "a
--   real, user-facing Block button for the first time").
--     1. `blocks.source` (text, NOT NULL) with a CHECK admitting only
--        `'profile'` for now.
--     2. The direct client INSERT and DELETE grants on `blocks` are REVOKED
--        from `authenticated`, and the two write policies that only existed to
--        scope those grants are dropped. Writing a block becomes RPC-only. The
--        SELECT grant and the "read only blocks you created" policy are left
--        exactly as they were (20260809211200).
--     3. `private.blocked_either_way(a, b)` — the single "is there a block
--        between these two people, in either direction" test. Created here,
--        consumed by the block-filtering amendment in the next three
--        migrations (20261009140000-20261009140200).
--     4. `private.has_safety_standing(caller, subject)` — "does the caller
--        have a real, prior relationship with this person", used to stop a
--        block (and, in 20261009150100, a report) being filed against an
--        arbitrary uuid.
--     5. `public.block_user(uuid, text)`, `public.unblock_user(uuid)` and
--        `public.list_my_blocks()`.
--
--   Nothing in the live app calls any of these yet: the Block button and the
--   blocked-users list exist only under the admin-gated `/MapTest` route
--   (amendment §9).
--
-- ===========================================================================
-- WHY THE DIRECT WRITE GRANTS ARE REVOKED
-- ===========================================================================
--   Until now `authenticated` could INSERT and DELETE its own `blocks` rows
--   directly (20260809211200), and nothing used that — there was no UI. A
--   block is about to start doing two things a bare row insert cannot do
--   safely on its own:
--     * remove any active connection between the two people (below), and
--     * in later phases, cancel meetups, close message threads and expire
--       pending requests between them.
--   If the row could still be inserted directly, a client could create the
--   block WITHOUT those side effects — e.g. block someone yet stay connected
--   to them, which the block-filtering amendment would then render as a
--   connection whose profile is unreadable. One write path that always does
--   all of it, in one transaction, is the only shape that cannot be half-run.
--   This is the same argument `soft_delete_own_account` (20260815130300) makes
--   for doing four writes in one function instead of four PostgREST calls.
--
--   The INSERT and DELETE POLICIES are dropped, not left behind. With no
--   grant they are inert, but an inert policy is an invitation: the natural
--   reaction to a permission error is to re-grant, and a re-grant would
--   silently bring the old bypass back to life. With no policy either, a
--   mistaken future `grant insert` still hits forced RLS with nothing
--   permitting it, and is refused.
--
--   Only `authenticated` loses anything. `service_role` keeps its default
--   privileges; the connect flow's `isBlockedEitherWay`
--   (`supabase-connect-store.ts`) reads `blocks` with the service role and is
--   unaffected. Zero rows existed in `blocks` on the live project when this
--   was written, so no existing block was created through the path being
--   closed.
--
-- ===========================================================================
-- blocks.source AND THE "WIDEN A CHECK TOGETHER" CONVENTION
-- ===========================================================================
--   `source` records which surface a block was filed from. Today there is
--   exactly one — a person's profile — so the CHECK admits exactly
--   `'profile'`. LATER PHASES WILL WIDEN THIS CHECK to add `'map'`, `'thread'`,
--   `'request'` and `'report'` as those surfaces are built, using the same
--   drop-and-re-add pattern 20260926120000 used to widen
--   `meetings.verification_method` and `connection_sessions.method` together:
--   the CHECK is dropped and re-added in the same migration that adds the
--   first caller of a new value, and `block_user` (or its successor) is
--   changed in that same migration. A value with no caller is never admitted
--   early — that is how a closed set stays meaningful.
--
--   NOT NULL with the default dropped straight after adding it: `add column
--   ... not null default 'profile'` labels any pre-existing row (none exist
--   live) with the only value the CHECK admits, and dropping the default
--   means every FUTURE insert must say where the block came from. A silent
--   default would let a later writer forget to set it and still succeed.
--
-- ===========================================================================
-- private.has_safety_standing — WHAT COUNTS AS "A REAL RELATIONSHIP", AND WHY
-- ===========================================================================
--   The phase brief: a block must not be fileable "against a totally
--   arbitrary uuid", but the response must not reveal whether a uuid is a
--   real person. So `block_user` checks standing and, when there is none,
--   does nothing and returns exactly what success returns.
--
--   Standing is TRUE when either:
--     (a) a `connections` row exists between the two, in ANY status — active
--         or removed. Removed counts deliberately: blocking someone REMOVES the
--         connection (below), so a person who blocks and then wants to report
--         (20261009150100) must still have standing, and so must someone who
--         removed a connection because of the behaviour they now want to
--         block or report.
--     (b) both are members of the same event's roster population —
--         `private.is_event_roster_member` (host, `going` RSVP, or a claimed
--         guest-list row) for some event. This is the population the roster
--         and the co-attendee profile branch draw on.
--
--   Considered and rejected as a standing source: "viewed their card
--   preview". `card_preview_views` (20260815120100) records disclosures to
--   SIGNED-OUT visitors only and stores no viewer identity, so there is
--   nothing to check against; a signed-in person who taps a card connects
--   instead, which is (a).
--
--   Deliberately BLOCK-AGNOSTIC and VISIBILITY-AGNOSTIC. It does not use
--   `can_see_user` / `shares_roster_event_with`, because after the next
--   migrations those refuse blocked pairs — and the person who was blocked
--   FIRST must still be able to file their own block back (otherwise, the day
--   the first blocker unblocks, the second person's wish not to be found is
--   silently missing). It is a statement about history ("these two people
--   have actually crossed paths in this product"), not about what either can
--   see right now. It never answers a client directly: it is not executable
--   by any client role and its only callers are `security definer` RPCs.
--
-- ===========================================================================
-- block_user — WHY ONE TRANSACTION, AND HOW LATER PHASES EXTEND IT
-- ===========================================================================
--   In order: refuse an unauthenticated / non-active caller; check standing
--   (none -> return `{ok:true}` having written nothing); insert the block
--   (idempotent — `on conflict do nothing`, so re-blocking keeps the original
--   row); then remove any ACTIVE connection between the two.
--
--   THE CONNECTION REMOVAL REUSES THE EXISTING TRANSITION, IT DOES NOT INVENT
--   ONE. The only existing way a connection leaves `active` is the one-way
--   `active -> removed` transition 20260809211200's "either party may remove
--   their own connection" policy permits and `removeConnection()` in
--   `apps/web/src/server/connections/connections-service.ts` performs:
--   `update connections set status = 'removed' where <it is the caller's
--   edge> and status = 'active'`. There is no `private.*` helper for it (that
--   TypeScript function is its only implementation), so the identical
--   statement is restated here as SQL: same column, same single value, same
--   `status = 'active'` precondition, keyed by the canonical ordered pair. It
--   never touches `origin_meeting_id`, never reactivates, never inserts.
--   `create_verified_connection` / `create_manual_connection` are untouched;
--   both already refuse to (re)connect a blocked pair.
--
--   EXTENSION POINT — READ THIS BEFORE ADDING TO block_user. Later phases
--   will add more side effects here once their tables exist: cancelling any
--   meetup between the two, closing their message thread, expiring pending
--   meet requests in either direction. That is WHY this is a single
--   function and a single transaction rather than several RPCs the client
--   calls in turn: adding a side effect later means adding another statement
--   to this body, inside the same transaction, after the block row is
--   written — not restructuring it, and never a second client round trip
--   that can fail independently and leave a "blocked but still has a live
--   meetup" state. Keep every side effect idempotent (each must be safe to
--   run on a re-block) and keep the response shape identical.
--
--   THE RESPONSE IS THE SAME IN EVERY CASE PAST AUTHENTICATION — `{ok:true}`
--   — whether the block was recorded, already existed, the uuid names a
--   stranger, or names nobody at all. So `block_user` cannot be used to test
--   whether a uuid is a real account, or whether a connection existed. The
--   one refusal a signed-in caller can see is `invalid_reason` (a reason over
--   500 characters), which depends only on their own input.
--
-- unblock_user deletes the caller's own block row and does NOT restore the
--   connection. Restoring it would recreate a live edge with no fresh meeting
--   behind it — the `removed -> active` transition 20260809211200 refuses to
--   clients for exactly that reason. Reconnecting means connecting again,
--   which `create_verified_connection` / `create_manual_connection` allow once
--   no block remains. Same `{ok:true}` whatever was there.
--
-- list_my_blocks returns, for each person the caller has blocked: their id
--   (which the caller supplied when blocking — nothing new), first name,
--   photo path, and when the block was made. A fixed four-column list from a
--   `security definer` function, never a widened grant on `users`: after the
--   block-filtering amendment the caller can no longer read the blocked
--   person's `users` row at all, which is the point. A DELETED account's name
--   and photo path come back null — deletion hides a person from every graph
--   reader (20260815130200) and a block list is one. The `reason` the caller
--   typed is not returned; nothing renders it yet.
--
--   NOTE FOR THE UI: the photo path is returned per the phase brief, but the
--   `profile-photos` storage policy refuses a blocked pair after
--   20261009140000 (`can_see_user`), so signing it through the caller's own
--   RLS-bound client fails and the blocked-users page falls back to initials.
--   Letting a blocker see the photo of the person they blocked would need a
--   new, deliberately-reviewed storage branch; it is not added here.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: EXECUTE on `public.block_user(uuid, text)`,
--     `public.unblock_user(uuid)` and `public.list_my_blocks()` to
--     `authenticated`. All three derive the caller from the JWT; none can act
--     on, or read, anyone else's blocks. EXECUTE on
--     `private.blocked_either_way(uuid, uuid)` to `authenticated`, solely
--     because the `users` SELECT policy (20261009140000) calls it directly and
--     a policy re-checks function EXECUTE as the caller (20260809211400); the
--     `private` schema has no USAGE grant, so no client can name it.
--   Forbids, newly: INSERT and DELETE on `public.blocks` to `authenticated`
--     (previously granted, scoped to the caller's own rows). UPDATE was never
--     granted and still is not. `private.has_safety_standing` is executable by
--     no client role. `anon` gets nothing.
--   Unchanged: SELECT on `blocks` to `authenticated`, filtered by "read only
--     blocks you created" — still no branch on `blocked_user_id`, so a blocked
--     person still cannot learn they were blocked.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. blocks.source
-- ---------------------------------------------------------------------------
alter table public.blocks
  add column source text not null default 'profile';

alter table public.blocks
  alter column source drop default;

alter table public.blocks
  add constraint blocks_source_check check (source in ('profile'));

comment on column public.blocks.source is
  'Which surface the block was filed from. ''profile'' only, for now '
  '(20261009130000); later phases widen the CHECK to add ''map'', ''thread'', '
  '''request'' and ''report'' in the same migration that adds the first caller '
  'of each — the drop-and-re-add convention 20260926120000 used for '
  'meetings.verification_method. No default: every writer must say.';

comment on table public.blocks is
  'Who has blocked whom. Readable only by the blocker (no branch on '
  'blocked_user_id, so nobody learns they were blocked). Since 20261009130000: '
  'written ONLY by public.block_user / public.unblock_user (no client INSERT '
  'or DELETE grant), and consulted by the users SELECT policy, the '
  'profile-photos storage policy, the event roster and the feed through '
  'private.blocked_either_way (20261009140000-20261009140200), in addition to '
  'connection time. See docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md.';

-- ---------------------------------------------------------------------------
-- 2. Close the direct write path
-- ---------------------------------------------------------------------------
-- A table-level REVOKE also revokes the column-level INSERT grant
-- 20260809211200 made on (blocker_user_id, blocked_user_id, reason).
revoke insert, delete on public.blocks from authenticated;

drop policy "block only on your own behalf" on public.blocks;
drop policy "unblock only your own blocks" on public.blocks;

-- ---------------------------------------------------------------------------
-- 3. private.blocked_either_way
-- ---------------------------------------------------------------------------
-- NULL IN -> TRUE ("treat as blocked"). Every consumer uses it as
-- `and not private.blocked_either_way(...)` to narrow a relationship branch,
-- so a null caller (no JWT) must make that branch DENY. Answering false for a
-- null would make the narrowing a no-op exactly when identity is missing.
--
-- The primary key (blocker_user_id, blocked_user_id) serves both directions:
-- each disjunct is a full-key equality lookup.
create or replace function private.blocked_either_way(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_a is null
      or p_b is null
      or exists (
           select 1
           from public.blocks b
           where (b.blocker_user_id = p_a and b.blocked_user_id = p_b)
              or (b.blocker_user_id = p_b and b.blocked_user_id = p_a)
         );
$$;

comment on function private.blocked_either_way(uuid, uuid) is
  'True if either user has blocked the other — or if either argument is null '
  '(fail closed: every consumer negates it to narrow a relationship branch). '
  'security definer so it sees both directions, which no client may read. '
  'The single definition behind the block-filtering amendment '
  '(20261009130000/20261009140000-140200).';

revoke all on function private.blocked_either_way(uuid, uuid) from public, anon, authenticated;
-- Required: the users SELECT policy calls this directly (20261009140000), and
-- a policy re-checks function EXECUTE as the caller (20260809211400).
grant execute on function private.blocked_either_way(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. private.has_safety_standing
-- ---------------------------------------------------------------------------
create or replace function private.has_safety_standing(p_caller uuid, p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_caller is not null
     and p_subject is not null
     and p_caller <> p_subject
     and (
       -- (a) a connection row in ANY status — see the header for why
       --     `removed` counts.
       exists (
         select 1
         from public.connections c
         where c.user_a_id = least(p_caller, p_subject)
           and c.user_b_id = greatest(p_caller, p_subject)
       )
       -- (b) the same event's roster population (host / going / claimed
       --     import). The caller's events are enumerated first so the
       --     subject test runs per caller-event, not per event in the table.
       or exists (
         select 1
         from (
           select e.id as event_id from public.events e where e.host_user_id = p_caller
           union
           select r.event_id from public.event_rsvps r
            where r.user_id = p_caller and r.status = 'going'
           union
           select i.event_id from public.event_attendee_imports i
            where i.claimed_by_user_id = p_caller
         ) mine
         where private.is_event_roster_member(p_subject, mine.event_id)
       )
     );
$$;

comment on function private.has_safety_standing(uuid, uuid) is
  'Whether p_caller has a real, prior relationship with p_subject: any '
  'connection row (active OR removed), or membership of the same event''s '
  'roster population. Deliberately ignores blocks and current visibility — '
  'it answers "have these two actually crossed paths", so a person blocked '
  'first can still block back, and a blocker can still report. Gate for '
  'block_user and submit_report only; not client-executable (20261009130000).';

revoke all on function private.has_safety_standing(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5a. public.block_user
-- ---------------------------------------------------------------------------
create or replace function public.block_user(p_target_user_id uuid, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_user is null
     or not exists (select 1 from public.users u where u.id = v_user and u.status = 'active') then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Depends only on the caller's own input, so it reveals nothing about the
  -- target and may be answered before the standing check.
  if v_reason is not null and char_length(v_reason) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_reason');
  end if;

  -- No standing (or no target, or self): write nothing, answer exactly as a
  -- successful block does. Not an existence oracle — see the header.
  if not private.has_safety_standing(v_user, p_target_user_id) then
    return jsonb_build_object('ok', true);
  end if;

  insert into public.blocks (blocker_user_id, blocked_user_id, reason, source)
  values (v_user, p_target_user_id, v_reason, 'profile')
  on conflict (blocker_user_id, blocked_user_id) do nothing;

  -- Side effect 1: the existing one-way active -> removed transition, restated
  -- (see the header). Idempotent: a second run matches no `active` row.
  update public.connections c
     set status = 'removed'
   where c.user_a_id = least(v_user, p_target_user_id)
     and c.user_b_id = greatest(v_user, p_target_user_id)
     and c.status = 'active';

  -- -------------------------------------------------------------------------
  -- EXTENSION POINT. Later phases add further side effects HERE, inside this
  -- same transaction, once their tables exist (in this order of intent):
  --   * cancel any active meetup between the two people;
  --   * close their meetup / connection message thread;
  --   * expire pending meet requests in either direction.
  -- Each must be idempotent and must not change the response below. See the
  -- migration header ("WHY ONE TRANSACTION, AND HOW LATER PHASES EXTEND IT").
  -- -------------------------------------------------------------------------

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.block_user(uuid, text) is
  'Blocks a person the caller has a real relationship with (private.'
  'has_safety_standing) and, in the same transaction, removes any active '
  'connection between them via the existing one-way active -> removed '
  'transition. Returns {ok:true} identically whether or not anything was '
  'written, so it is not an existence oracle. The single write path for '
  'blocks (20261009130000); later phases extend its body, not its shape.';

revoke all on function public.block_user(uuid, text) from public, anon;
grant execute on function public.block_user(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5b. public.unblock_user
-- ---------------------------------------------------------------------------
create or replace function public.unblock_user(p_target_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
begin
  if v_user is null
     or not exists (select 1 from public.users u where u.id = v_user and u.status = 'active') then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  delete from public.blocks b
   where b.blocker_user_id = v_user
     and b.blocked_user_id = p_target_user_id;

  -- Deliberately nothing else: the connection the block removed stays
  -- removed (see the header).
  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.unblock_user(uuid) is
  'Removes the caller''s own block on a person. Does NOT restore any '
  'connection the block removed — reconnecting means connecting again. '
  'Returns {ok:true} whether or not a block existed (20261009130000).';

revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5c. public.list_my_blocks
-- ---------------------------------------------------------------------------
create or replace function public.list_my_blocks()
returns table (
  blocked_user_id uuid,
  first_name text,
  photo_path text,
  blocked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    b.blocked_user_id,
    case when u.status = 'deleted' then null else u.first_name end,
    case when u.status = 'deleted' then null else u.photo_path end,
    b.created_at
  from public.blocks b
  left join public.users u on u.id = b.blocked_user_id
  where b.blocker_user_id = private.current_user_id()
  order by b.created_at desc;
$$;

comment on function public.list_my_blocks() is
  'The caller''s own blocks: blocked person''s id, first name, photo path and '
  'when — nothing else about them, ever. Name and photo are null for a '
  'deleted account. Empty for no JWT (20261009130000).';

revoke all on function public.list_my_blocks() from public, anon;
grant execute on function public.list_my_blocks() to authenticated;
