-- =============================================================================
-- 20260809211200_rls_policies_graph_and_meetings.sql
--
-- WHAT THIS CHANGES
--   Adds RLS policies and matching narrow grants for `connections`, `blocks`,
--   `meetings`, `meeting_participants`, `meeting_locations` and
--   `connection_sessions`.
--
-- THE HEADLINE: NOTHING HERE CAN CREATE A CONNECTION
--   There is deliberately no INSERT policy on `connections`, on `meetings`, on
--   `meeting_participants`, on `meeting_locations` or on `connection_sessions`,
--   and no grant of INSERT to `authenticated` on any of them. Every row in the
--   social graph is written by `createVerifiedConnection()` running with the
--   service role, and that function accepts only a successful outcome produced
--   by a verifier (§4.1). §4.7 threat 4 names this as the structural defence
--   against mass fake-account farming, and its instruction is blunt: never add a
--   second path that writes connections. An INSERT policy here would be exactly
--   that second path, reachable directly from any client holding a user token.
--
--   Concretely, the attack this closes: a farmed account calls PostgREST
--   directly — bypassing every API route, every rate limit and every GPS check —
--   and inserts rows into `connections`. With no INSERT policy and no INSERT
--   grant, Postgres refuses before any of our code is involved.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- connections
-- ---------------------------------------------------------------------------
-- §3.3, verbatim (with `to authenticated` added, which only narrows — see the
-- note in 20260809211100). Deliberately no "connections of my connections"
-- branch: degree-of-separation questions are answered by
-- private.connections_attending() inside a context the user is already in, and
-- the database never hands over the rows themselves.
grant select on public.connections to authenticated;

-- UPDATE is granted on `status` only, so the endpoints of an edge, its id and
-- above all `origin_meeting_id` — the evidence that justifies the edge — cannot
-- be rewritten by a client.
grant update (status) on public.connections to authenticated;

create policy "you can read only your own edges"
on public.connections for select to authenticated using (
  user_a_id = (select private.current_user_id())
  or user_b_id = (select private.current_user_id())
);

-- Removing a connection is a legitimate user action and the `removed` status
-- exists for it (§2.3). The policy makes it a *one-way* transition: USING
-- requires the row to currently be `active`, WITH CHECK requires it to end up
-- `removed`. So a client can remove an edge and can never restore one.
--
-- That asymmetry is the product rule in miniature. Re-activating a removed
-- connection would create a live edge with no fresh verification behind it —
-- the same outcome as an INSERT, reached by a different verb. Getting
-- reconnected has to mean meeting again.
create policy "either party may remove their own connection"
on public.connections for update to authenticated
using (
  (
    user_a_id = (select private.current_user_id())
    or user_b_id = (select private.current_user_id())
  )
  and status = 'active'
)
with check (
  (
    user_a_id = (select private.current_user_id())
    or user_b_id = (select private.current_user_id())
  )
  and status = 'removed'
);

-- ---------------------------------------------------------------------------
-- blocks
-- ---------------------------------------------------------------------------
-- Readable only by the blocker. There is no policy branch on `blocked_user_id`,
-- and that omission is the security property: if a blocked person could read
-- the row, the product would be telling them they had been blocked. That is a
-- safety problem in a network built around people who have met in person, and
-- it is also an invitation to go and create a second account.
--
-- DELETE (unblocking) is allowed; UPDATE is not granted, because there is
-- nothing on the row worth editing in place — changing your mind means removing
-- the block and, if you want, adding it again.
grant select on public.blocks to authenticated;
grant insert (blocker_user_id, blocked_user_id, reason) on public.blocks to authenticated;
grant delete on public.blocks to authenticated;

create policy "read only blocks you created"
on public.blocks for select to authenticated
using (blocker_user_id = (select private.current_user_id()));

create policy "block only on your own behalf"
on public.blocks for insert to authenticated
with check (blocker_user_id = (select private.current_user_id()));

create policy "unblock only your own blocks"
on public.blocks for delete to authenticated
using (blocker_user_id = (select private.current_user_id()));

-- ---------------------------------------------------------------------------
-- meetings
-- ---------------------------------------------------------------------------
-- Read: participants always; mutuals of both parties when the meeting is not
-- private and nobody has marked it private. That second path is the triadic
-- "A met B" feed post from §2.9. The rule lives in
-- private.can_see_meeting() so that this table and `meeting_participants`
-- cannot drift apart — see the reasoning at that function.
--
-- Write: participants may change the meeting-level privacy flags and nothing
-- else. `occurred_at`, `verification_method`, `verification_session_id` and
-- `event_id` are the record of what was verified, and a client that could edit
-- them could rewrite the evidence for its own connection.
--
-- Note how the two privacy controls differ, because it matters to the product:
-- `is_private` and `location_visibility` sit on the meeting and either
-- participant can change them, including undoing the other's change; whereas
-- `meeting_participants.marked_private` is per-person and the other party has no
-- policy that reaches it. Anyone who wants a veto their counterpart cannot
-- override uses the latter.
grant select on public.meetings to authenticated;
grant update (is_private, location_visibility) on public.meetings to authenticated;

create policy "read meetings you were at, or your mutuals' meetings"
on public.meetings for select to authenticated
using ((select private.can_see_meeting(private.current_user_id(), meetings.id)));

create policy "participants may change meeting privacy flags"
on public.meetings for update to authenticated
using (
  exists (
    select 1 from public.meeting_participants mp
    where mp.meeting_id = meetings.id
      and mp.user_id = (select private.current_user_id())
  )
)
with check (
  exists (
    select 1 from public.meeting_participants mp
    where mp.meeting_id = meetings.id
      and mp.user_id = (select private.current_user_id())
  )
);

-- ---------------------------------------------------------------------------
-- meeting_participants
-- ---------------------------------------------------------------------------
-- Visibility follows the meeting: if you can see that a meeting happened you
-- can see who was in it, because a meeting post with the participants stripped
-- out conveys nothing. Your own participation rows are always visible, so a
-- meeting can never become invisible to someone who was there.
--
-- The only writable columns are that person's own two privacy switches. Nobody
-- can add or remove a participant — participation is a fact established by the
-- verification service, not a claim a client gets to make.
grant select on public.meeting_participants to authenticated;
grant update (location_share_consent, marked_private) on public.meeting_participants to authenticated;

create policy "read participants of meetings you can see"
on public.meeting_participants for select to authenticated
using (
  user_id = (select private.current_user_id())
  or (select private.can_see_meeting(
        private.current_user_id(), meeting_participants.meeting_id))
);

create policy "set your own consent and privacy flags"
on public.meeting_participants for update to authenticated
using (user_id = (select private.current_user_id()))
with check (user_id = (select private.current_user_id()));

-- ---------------------------------------------------------------------------
-- meeting_locations   (highest stakes — §3.2)
-- ---------------------------------------------------------------------------
-- Only SELECT is granted, and the policy below is §3.2 verbatim.
--
-- There is no INSERT, UPDATE or DELETE policy on this table at all, by design
-- (§2.4/§3.2): location rows are written only by the verification service. That
-- service does not exist yet, so today nothing can write here through RLS. That
-- is the intended state, not an oversight.
--
-- Two details in the policy that look like style and are not:
--   * Path B is written as "prove nobody objected" (`not exists ... consent =
--     false or marked_private = true`) rather than "prove everybody agreed". A
--     missing or malformed participant row therefore blocks sharing rather than
--     permitting it. For coordinates describing where a named person physically
--     stood, that is the only acceptable direction to fail in.
--   * It requires the meeting to be opted in (`location_visibility = 'mutuals'`)
--     AND not private AND unanimously consented AND the viewer to be a mutual of
--     both parties. Four independent conditions, any one of which denies.
grant select on public.meeting_locations to authenticated;

create policy "location visible to participants, or to mutuals only with full consent"
on public.meeting_locations for select to authenticated using (
  -- Path A: you were there.
  exists (
    select 1 from public.meeting_participants mp
    where mp.meeting_id = meeting_locations.meeting_id
      and mp.user_id = (select private.current_user_id())
  )
  or
  -- Path B: you are a mutual of BOTH, meeting is not private,
  -- it is marked shareable, and EVERY participant consented.
  (
    exists (
      select 1 from public.meetings m
      where m.id = meeting_locations.meeting_id
        and m.is_private = false
        and m.location_visibility = 'mutuals'
    )
    and not exists (
      select 1 from public.meeting_participants mp
      where mp.meeting_id = meeting_locations.meeting_id
        and (mp.location_share_consent = false or mp.marked_private = true)
    )
    and (select private.is_mutual_of_both(
          private.current_user_id(),
          private.meeting_party(meeting_locations.meeting_id, 1),
          private.meeting_party(meeting_locations.meeting_id, 2)))
  )
);

-- ---------------------------------------------------------------------------
-- connection_sessions
-- ---------------------------------------------------------------------------
-- The presenter may read their own session — it is their own screen's state,
-- and the nonce it contains is already displayed to them. Nobody else can read
-- it, including the person who scanned it: the row carries the presenter's
-- coordinates and last heartbeat time, and handing those to a scanner would
-- give away a position the product never promised to share.
--
-- No INSERT, UPDATE or DELETE, for anyone, through RLS. This is the strictest
-- table in the schema after `connection_attempts`, and the reason is §4.2 step
-- 6: single-use is enforced at the session level. A client that could write
-- `status` back to `active`, or overwrite `current_nonce`, or extend
-- `expires_at`, would defeat threats 1 and 3 outright — every screenshotted
-- token becomes live again. Sessions are created, rotated and consumed only by
-- the verification service.
grant select on public.connection_sessions to authenticated;

create policy "presenters may read their own sessions"
on public.connection_sessions for select to authenticated
using (presenter_user_id = (select private.current_user_id()));
