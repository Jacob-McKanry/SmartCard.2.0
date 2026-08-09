-- =============================================================================
-- 20260809210900_rls_helper_functions.sql
--
-- WHAT THIS CHANGES
--   Creates the `security definer` helper functions that RLS policies call to
--   answer graph-position questions, in the `private` schema, per architecture
--   doc §3.1. Nothing is granted to any client role.
--
-- THE FIVE FROM §3.1 / §3.2 / §3.3
--   private.current_user_id()
--   private.are_connected(a, b)
--   private.is_mutual_of_both(viewer, a, b)
--   private.shares_event_with(viewer, other)
--   private.connections_attending(event_id)
--   private.meeting_party(meeting_id, n)      -- referenced by §3.2, spec'd here
--
-- TWO ADDITIONS, AND WHY
--   private.can_see_meeting(viewer, meeting_id)
--   private.can_see_event(viewer, event_id)
--   Both exist because the same visibility rule has to be applied from more
--   than one table's policy — a meeting's visibility governs `meetings` and
--   `meeting_participants`, an event's governs `events` and whether you may
--   RSVP to it. Writing the rule twice would mean two places to keep in sync,
--   and the failure mode of them drifting apart is a silent disclosure. These
--   are extensions of §3.1's pattern, not departures from it; recorded in §3.6
--   of the architecture doc.
--
-- WHY EVERY FUNCTION IS `stable security definer set search_path = ''`
--   security definer: the helper has to see rows the caller cannot. Asking "are
--   these two people connected?" requires reading `connections` rows that the
--   asker is not entitled to read directly. The function owner (`postgres`) has
--   BYPASSRLS, so inside these bodies RLS does not apply and the answer is
--   computed from the true graph — then only a boolean comes back out. This is
--   §3.3's principle in mechanical form: "the database never hands over rows, it
--   hands back a computed answer."
--
--   set search_path = '': §3.1 calls this out and it is the single most
--   important line in this file. A `security definer` function with an
--   inherited search_path can be hijacked by anyone able to create an object in
--   a schema earlier in that path — they define their own `connections` table or
--   their own `=` operator, the function resolves to it, and their code runs
--   with the definer's rights. Pinning the path to empty forces every reference
--   in these bodies to be schema-qualified, which is why they all read
--   `public.connections` rather than `connections`.
--
--   stable: the answer cannot change within a statement, so Postgres may
--   evaluate once instead of once per row. Combined with policies wrapping
--   calls as `(select private.fn(...))`, this is what keeps a graph-gated
--   SELECT from turning into a per-row function call storm.
--
-- ACCESS GRANTED / FORBIDDEN
--   EXECUTE is revoked from PUBLIC, `anon` and `authenticated` on every
--   function here, and `private` is not in PostgREST's exposed schema list, so
--   none of these is reachable as an RPC. RLS policies can still call them:
--   a policy expression is stored pre-analysed and is evaluated with the table
--   owner's rights, so it does not re-check the caller's EXECUTE privilege.
--   That combination is the goal — the policies get an oracle, the users do not.
--   §3.3 is explicit that no function may answer "who is connected to this
--   arbitrary person"; keeping these uncallable is how that is guaranteed
--   rather than merely intended.
--
--   *** CORRECTION — the paragraph above is wrong and is superseded by
--   *** 20260809211400_rls_helper_function_grants.sql. Postgres re-checks
--   *** EXECUTE against the *calling* role even inside a policy expression;
--   *** the owner-rights rule applies to referenced tables, not to functions.
--   *** With this blanket revoke alone, every policy in the schema failed with
--   *** "permission denied for function current_user_id". That migration grants
--   *** EXECUTE to `authenticated` on the seven policy-referenced helpers and
--   *** explains why doing so does not reopen the §3.3 oracle (schema USAGE on
--   *** `private` stays revoked, so the functions still cannot be named in a
--   *** query, and PostgREST cannot reach the schema at all). This text is left
--   *** in place rather than rewritten because an applied migration is history.
--
--   Every function is also written to fail closed on null input. A null
--   `current_user_id()` (no JWT, or a request that never went through the token
--   exchange in §5.4) makes every branch false and every policy deny. Until the
--   Kinde -> Supabase token-exchange service exists, that is the expected state
--   of the whole database: correct, not broken.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- current_user_id
-- ---------------------------------------------------------------------------
-- Deliberately a thin wrapper over auth.uid() with no table access at all.
--
-- Two reasons it does not, for example, also check that the user is `active`:
--
--  1. Recursion. Every table in this schema has FORCE ROW LEVEL SECURITY, and
--     the `users` select policy calls this function. If this function read
--     `public.users`, that read would be subject to the very policy that is
--     calling it. It happens to be safe today only because the owner has
--     BYPASSRLS; relying on that for the most-called function in the system is
--     a trap for whoever changes ownership later.
--  2. Separation of concerns. Account status is an authentication question and
--     belongs at the point tokens are minted (§5.4): a suspended user should
--     never receive a Supabase JWT in the first place. Enforcing it a second
--     time in every policy evaluation buys little and costs a lookup per query.
--
-- The indirection still earns its place: §5.4's token-exchange design may
-- change (Q7 is open, and Supabase is moving toward asymmetric signing keys).
-- When it does, this one function changes and every policy in the database
-- keeps working.
create or replace function private.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid();
$$;

comment on function private.current_user_id() is
  'The authenticated caller''s public.users.id, taken from the `sub` claim of the '
  'Supabase JWT minted by the token exchange in §5.4. Returns null when there is no '
  'valid token, which makes every policy that calls it deny — the correct '
  'fail-closed behaviour, including right now while that service does not yet exist.';

-- ---------------------------------------------------------------------------
-- are_connected
-- ---------------------------------------------------------------------------
-- Looks the pair up in canonical order. Because `connections` stores the
-- smaller UUID first (§2.3), one equality test on the ordered pair is a
-- complete answer — there is no "or the other way round" branch to forget,
-- which is the practical payoff of that constraint.
create or replace function private.are_connected(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select a is not null
     and b is not null
     and a <> b
     and exists (
       select 1
       from public.connections c
       where c.user_a_id = least(a, b)
         and c.user_b_id = greatest(a, b)
         and c.status = 'active'
     );
$$;

comment on function private.are_connected(uuid, uuid) is
  'True if an active mutual connection exists between two users. Only `active` '
  'counts: removing a connection must actually remove the access it granted, not '
  'just hide it from a list.';

-- ---------------------------------------------------------------------------
-- is_mutual_of_both
-- ---------------------------------------------------------------------------
-- The triadic test behind the "A met B" feed post and the shared-location rule.
-- The viewer must be connected to both parties and be neither of them, so the
-- caller cannot accidentally satisfy the check by passing themselves in.
--
-- Null-safe by construction: private.meeting_party() returns null when a
-- meeting does not have an nth participant, and a null argument makes this
-- false. A malformed meeting therefore hides its post rather than exposing it.
create or replace function private.is_mutual_of_both(viewer uuid, a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select viewer is not null
     and a is not null
     and b is not null
     and viewer <> a
     and viewer <> b
     and private.are_connected(viewer, a)
     and private.are_connected(viewer, b);
$$;

comment on function private.is_mutual_of_both(uuid, uuid, uuid) is
  'True if `viewer` holds an active connection to both `a` and `b` and is neither. '
  'Null arguments return false, so an incomplete meeting fails closed.';

-- ---------------------------------------------------------------------------
-- meeting_party
-- ---------------------------------------------------------------------------
-- Referenced by the §3.2 policy but not specified there. Returns the nth
-- participant of a meeting, ordered deterministically.
--
-- The ordering is the whole design. Without an explicit ORDER BY, Postgres may
-- return participants in any order and is free to return them in a *different*
-- order for the two calls inside a single policy evaluation. That would make
-- `is_mutual_of_both(viewer, party(m,1), party(m,2))` sometimes compare the
-- viewer against the same person twice — which can flip the answer in either
-- direction. Ordering by `user_id` is stable, cheap, and independent of
-- insertion order and physical row layout.
--
-- n < 1 returns null rather than clamping, so a mis-called helper denies
-- instead of silently answering about participant 1.
create or replace function private.meeting_party(p_meeting_id uuid, n integer)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_meeting_id is null or n is null or n < 1 then null
    else (
      select mp.user_id
      from public.meeting_participants mp
      where mp.meeting_id = p_meeting_id
      order by mp.user_id
      offset (n - 1)
      limit 1
    )
  end;
$$;

comment on function private.meeting_party(uuid, integer) is
  'The nth participant of a meeting, ordered by user_id for determinism. Returns '
  'null when there is no nth participant, which makes the callers fail closed. '
  'Meetings are pairwise by construction, so callers use n = 1 and n = 2; see the '
  'group-meeting warning in 20260809210500 before changing that assumption.';

-- ---------------------------------------------------------------------------
-- shares_event_with
-- ---------------------------------------------------------------------------
-- The "co-attendee" branch of the §3.4 users policy: you may see the profile of
-- someone who is going to the same event as you, because that is a context you
-- are both already in and it is how you look up the person you just met at a
-- pilot event.
--
-- Only `going` counts on both sides. `interested` is an intention, not
-- attendance, and letting it count would mean two strangers who both tapped
-- "interested" on a large public event become mutually visible — a much wider
-- door than §3.4 intends. Recorded as a judgment call in §3.6 of the
-- architecture doc; §2.6 does not define which statuses constitute attendance.
create or replace function private.shares_event_with(viewer uuid, other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select viewer is not null
     and other is not null
     and viewer <> other
     and exists (
       select 1
       from public.event_rsvps mine
       join public.event_rsvps theirs on theirs.event_id = mine.event_id
       where mine.user_id = viewer
         and mine.status = 'going'
         and theirs.user_id = other
         and theirs.status = 'going'
     );
$$;

comment on function private.shares_event_with(uuid, uuid) is
  'True if both users have RSVP''d `going` to the same event. This is the widest '
  'branch of the users read policy and the one to re-examine first if event sizes '
  'grow beyond the pilot — it is scoped by a shared context, not by the graph.';

-- ---------------------------------------------------------------------------
-- connections_attending
-- ---------------------------------------------------------------------------
-- §3.3's "you know 4 people going" mechanism. It returns only people already in
-- the caller's graph, so the answer cannot be used to enumerate an event's
-- attendee list — which is exactly why the feature is a function rather than a
-- relaxed policy on `event_rsvps`.
--
-- Note it re-derives the viewer from the JWT rather than taking a viewer
-- argument. That is deliberate: a viewer parameter would let a caller ask the
-- question on someone else's behalf, which is the "who is connected to this
-- arbitrary person" capability §3.3 rules out.
--
-- No client-facing exposure is created here. `private` is not a PostgREST
-- schema, so calling this from the apps will need a thin wrapper in `public`
-- with an EXECUTE grant to `authenticated` — that belongs to the events build
-- phase, alongside the feature that consumes it, not to this schema migration.
create or replace function private.connections_attending(p_event_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.user_id
  from public.event_rsvps r
  where p_event_id is not null
    and r.event_id = p_event_id
    and r.status = 'going'
    and private.are_connected(private.current_user_id(), r.user_id);
$$;

comment on function private.connections_attending(uuid) is
  'The caller''s own connections who are going to a given event (§3.3). Returns a '
  'computed answer rather than granting row access, and derives the viewer from '
  'the JWT so it cannot be asked about anyone else.';

-- ---------------------------------------------------------------------------
-- can_see_meeting
-- ---------------------------------------------------------------------------
-- The meeting-visibility rule, in one place, applied by both the `meetings` and
-- `meeting_participants` policies.
--
-- Path A: you were there. Participants always see their own meeting, whatever
-- privacy flags are set — privacy controls exist to limit third parties, not to
-- hide a meeting from the people who had it.
--
-- Path B: the triadic "A met B" feed post. Written in §3.2's "prove nobody
-- objected" style: it requires the meeting not to be flagged private AND no
-- participant to have marked it private. Phrasing the second test as
-- `not exists (... marked_private = true)` rather than `exists (... all agreed)`
-- means a missing or malformed participant row blocks the post instead of
-- permitting it.
--
-- Judgment call recorded in §3.6 of the architecture doc: Path B requires the
-- viewer to be a mutual of *both* parties, not merely connected to one. The doc
-- gives a worked policy only for `meeting_locations` (§3.2), which uses
-- mutual-of-both; applying the looser "connected to either" rule to the meeting
-- itself would surface the existence and identity of someone the viewer has no
-- relationship with. If the feed phase wants the looser rule, that is a
-- reviewed migration and a conscious decision.
create or replace function private.can_see_meeting(viewer uuid, p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select viewer is not null
     and p_meeting_id is not null
     and (
       exists (
         select 1
         from public.meeting_participants mp
         where mp.meeting_id = p_meeting_id
           and mp.user_id = viewer
       )
       or (
         exists (
           select 1
           from public.meetings m
           where m.id = p_meeting_id
             and m.is_private = false
         )
         and not exists (
           select 1
           from public.meeting_participants mp
           where mp.meeting_id = p_meeting_id
             and mp.marked_private = true
         )
         and private.is_mutual_of_both(
               viewer,
               private.meeting_party(p_meeting_id, 1),
               private.meeting_party(p_meeting_id, 2))
       )
     );
$$;

comment on function private.can_see_meeting(uuid, uuid) is
  'Whether a viewer may see that a meeting happened: participants always, plus '
  'mutuals of both parties when nobody has marked it private. Says nothing about '
  'the meeting''s location — that is a separate, stricter test (§3.2).';

-- ---------------------------------------------------------------------------
-- can_see_event
-- ---------------------------------------------------------------------------
-- Applied by the `events` select policy and by the check on creating an RSVP.
--
-- The `public` branch is true for any authenticated user, which is the one
-- deliberate exception to "every readable row is justified by a graph
-- relationship". §2.6 states the reasoning: a public event at a public venue is
-- meant to be found, and its row describes a place and a time, not a person's
-- movements. It also creates no path to the thing the product actually protects
-- — reading an event does not reveal who is attending (`event_rsvps` stays
-- narrow), does not make any attendee's profile readable on its own, and does
-- not offer any way to connect to anyone. Contrast `users`, where a single
-- always-true branch would be a global directory.
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
           e.visibility = 'public'
           or e.host_user_id = viewer
           or exists (
             select 1
             from public.event_rsvps r
             where r.event_id = e.id
               and r.user_id = viewer
           )
         )
     );
$$;

comment on function private.can_see_event(uuid, uuid) is
  'Whether a viewer may see an event: public events to any authenticated user '
  '(deliberate exception, §2.6), private events to the host and to anyone who '
  'already has an RSVP row for it.';

-- ---------------------------------------------------------------------------
-- Lock every helper away from client roles
-- ---------------------------------------------------------------------------
-- Belt and braces on top of the schema-level revoke in 20260809210000: Postgres
-- grants EXECUTE on new functions to PUBLIC by default, and PUBLIC includes
-- anon and authenticated.
revoke all on function private.current_user_id() from public, anon, authenticated;
revoke all on function private.are_connected(uuid, uuid) from public, anon, authenticated;
revoke all on function private.is_mutual_of_both(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.meeting_party(uuid, integer) from public, anon, authenticated;
revoke all on function private.shares_event_with(uuid, uuid) from public, anon, authenticated;
revoke all on function private.connections_attending(uuid) from public, anon, authenticated;
revoke all on function private.can_see_meeting(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_see_event(uuid, uuid) from public, anon, authenticated;
