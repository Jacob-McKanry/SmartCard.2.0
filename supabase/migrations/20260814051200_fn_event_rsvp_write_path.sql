-- =============================================================================
-- 20260814051200_fn_event_rsvp_write_path.sql
--
-- WHAT THIS CHANGES
--   Takes `event_rsvps` away from clients entirely as a WRITE target, and
--   replaces the direct INSERT/UPDATE/DELETE path 20260809211300 granted with
--   five `security definer` functions in `public`, callable over PostgREST by
--   `authenticated`:
--
--     public.request_event_rsvp(event_id, status)     -- self-service
--     public.withdraw_event_rsvp(event_id)            -- self-service
--     public.decide_event_rsvp(rsvp_id, decision, override)  -- host only
--     public.event_attendance_counts(event_id)        -- aggregate, no rows
--     public.event_rsvp_queue(event_id)               -- host only, no rows for anyone else
--
--   plus one internal helper, `private.promote_event_waitlist(event_id)`, and
--   an AFTER UPDATE trigger on `events.capacity`.
--
-- WHY THE OLD WRITE PATH IS NOW A PRIVILEGE ESCALATION
--   20260809211300 granted `insert (event_id, user_id, status)` and
--   `update (status, responded_at)` directly, with policies that checked "is
--   this row yours" and "can you see this event". That was correct at the time
--   and is not correct now, and the difference is exactly what
--   20260814051000 added:
--
--     * `requires_approval` means `going` can be a decision the HOST makes. A
--       client that can write `status = 'going'` can approve itself. The
--       approval gate would be advice, not a gate.
--     * `capacity` means `going` is a scarce resource. A client that can write
--       `status = 'going'` can take a seat at a full event, and can do it
--       repeatedly, and can do it after being waitlisted.
--     * `pending`, `waitlist` and `denied` are OUTCOMES the server computes.
--       A client that could assert `denied` about itself, or `waitlist` about
--       itself, would be writing a fact about someone else's decision.
--
--   And one consequence that is not about this feature at all: `going` is a
--   branch of the `users` read policy via `private.shares_event_with()` (§3.4).
--   A freely-writable `going` is therefore a freely-writable input to the rule
--   that decides who may read whose profile. That is the strongest reason the
--   value has to be computed rather than accepted.
--
--   So this migration applies the pattern the graph tables have used since day
--   one, for the same reason. `connections`, `meetings`, `meeting_participants`
--   and `meeting_locations` have no INSERT policy and no INSERT grant at all,
--   which is what makes "only a verified meeting can create an edge" a property
--   of the database rather than a property of the code that talks to it
--   (§4.7 threat 4). `event_rsvps` now works the same way: there is exactly one
--   path that writes a status, it computes the value from the event's own
--   configuration, and the value a caller *asked* for is only ever an input to
--   that computation.
--
-- WHAT THIS GRANTS, EXACTLY, AND TO WHOM
--   REVOKED from `authenticated` on public.event_rsvps: INSERT, UPDATE, DELETE
--     — every write verb. The three write policies are dropped along with them
--     rather than left behind as inert decoration, so that if someone ever
--     re-grants a verb here it fails closed (RLS with no policy denies every
--     row) instead of quietly restoring the old behaviour.
--   KEPT: `grant select on public.event_rsvps to authenticated` and the
--     "read your own rsvps and your connections' rsvps" policy, both unchanged.
--     Reading was never the problem.
--   GRANTED: EXECUTE on the five `public` functions above, to `authenticated`
--     only. `anon` gets nothing, as everywhere in this schema.
--   NOT GRANTED: EXECUTE on `private.promote_event_waitlist` to anybody. It is
--     only ever called from inside the definer functions here and from the
--     trigger, both of which run as the function owner, so no client role needs
--     the privilege.
--
-- WHY THESE ARE `security definer`, WHICH IS THE OPPOSITE CALL FROM
-- `create_verified_connection` AND `rate_limit_consume`
--   Both of those are deliberately `security invoker`, on the reasoning that
--   their only caller is the service role, so a mistaken `grant execute ... to
--   authenticated` would land on a role holding no table privilege and simply
--   fail. That argument does not transfer here, because the intended caller IS
--   `authenticated`, and after this migration `authenticated` holds no write
--   privilege on `event_rsvps` at all. An invoker-rights function could not do
--   the job.
--
--   The safety property has to come from somewhere else, and it comes from the
--   same place `private.connections_attending()` gets it: **these functions
--   never take an actor as a parameter.** The caller is derived from the JWT
--   via `private.current_user_id()` inside every one of them. There is no
--   argument any caller can pass that makes the function act as somebody else,
--   which is what keeps "definer rights" from meaning "impersonation". Every
--   authorization question the dropped policies used to answer is answered
--   again inside these bodies, explicitly, and each one fails closed:
--   a null caller, an invisible event, a non-host, an undecidable row and a
--   malformed argument all refuse rather than proceed.
--
--   `set search_path = ''` on every function, for the reason §3.1 gives and
--   20260809210900's header spells out: a definer function with an inherited
--   search_path can be hijacked into running someone else's code with the
--   owner's rights. Every reference below is schema-qualified.
--
-- WHY THEY RETURN A REASON INSTEAD OF RAISING
--   Same choice `create_verified_connection` made: a refusal is an ordinary
--   answer to an ordinary request ("that event is full"), not an exception, and
--   `{ok: false, reason: ...}` is something the service layer can turn into a
--   sentence for a person. Genuinely unexpected states still raise.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Close the old write path FIRST
-- ---------------------------------------------------------------------------
-- Order matters for reviewability, not for correctness: everything below this
-- point is additive, so a reader who stops here has already seen the whole of
-- what was taken away.
drop policy "rsvp only as yourself, only to events you can see" on public.event_rsvps;
drop policy "change only your own rsvp" on public.event_rsvps;
drop policy "withdraw only your own rsvp" on public.event_rsvps;

revoke insert on public.event_rsvps from authenticated;
revoke update on public.event_rsvps from authenticated;
revoke delete on public.event_rsvps from authenticated;

-- ---------------------------------------------------------------------------
-- private.is_event_host
-- ---------------------------------------------------------------------------
-- "Is this viewer the host of this event?", answered underneath RLS.
--
-- It exists for the same reason `can_see_event` does (§3.6): the same
-- authorization question is asked from four places — two functions below, the
-- host queue, and the `event-covers` Storage write policy (20260814051400) —
-- and four copies of an access rule is a disclosure waiting to happen.
--
-- Null-safe by construction: a null viewer or a null event id makes it false,
-- so an unauthenticated caller fails closed exactly like every §3.1 helper.
create or replace function private.is_event_host(viewer uuid, p_event_id uuid)
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
         and e.host_user_id = viewer
     );
$$;

comment on function private.is_event_host(uuid, uuid) is
  'True if `viewer` hosts the given event. The single definition of "is the host", '
  'used by the RSVP decision RPC, the host queue, the attendance counts and the '
  'event-covers Storage write policy. Null arguments are false (fail closed).';

revoke all on function private.is_event_host(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- private.promote_event_waitlist
-- ---------------------------------------------------------------------------
-- Fills every seat that is currently free from the front of the waitlist, and
-- returns how many people it moved.
--
-- WHY THIS IS NOT A CRON JOB
--   A freed seat that is filled "soon" is a seat that, for some window, exists
--   and belongs to nobody — the person who should have it cannot take it
--   (they are still `waitlist`), and anybody refreshing the page can take it
--   instead. That turns a fair queue into a race won by whoever polls hardest.
--   Every caller below runs this inside the same transaction that freed the
--   seat, holding a row lock on the event, so from outside the transaction the
--   seat is never observably empty.
--
-- WHY IT LOOPS INSTEAD OF PROMOTING EXACTLY ONE
--   Seats can free or appear more than one at a time — a capacity raise from 10
--   to 20 is ten seats at once (see the trigger at the end of this file). "One
--   per freed seat" would leave nine people waiting for a queue that has room
--   for them, which is the same unfairness in slower motion. The loop is
--   bounded by the number of waitlist rows and exits as soon as the event is
--   full, so an unlimited-capacity event promotes everyone waiting and stops.
--
-- WHY `order by responded_at, id`
--   FIFO by when the person joined the waitlist, which is the only ordering
--   that makes waiting mean anything. `id` is a tie-break, not decoration: two
--   rows can share a `responded_at` (same statement, or a coarse clock), and
--   without a deterministic second key Postgres may pick either — so the same
--   queue could report two different "next person" answers to two callers.
--   The same reasoning `private.meeting_party()` records for ordering by
--   `user_id`.
--
-- WHY A PROMOTION SETS `decided_at` BUT LEAVES `decided_by` NULL
--   Nobody decided. The system moved the row because a seat freed, and naming
--   a host as the decider would be a false audit record — the host may have
--   been asleep. The pair (decided_at set, decided_by null) is the documented
--   encoding for "system-promoted"; see the column comments in 20260814051000.
--
-- Capacity is re-read inside this function rather than passed in, so it cannot
-- be called with a stale or caller-supplied cap.
create or replace function private.promote_event_waitlist(p_event_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_capacity integer;
  v_going integer;
  v_promoted integer := 0;
  v_row record;
begin
  if p_event_id is null then
    return 0;
  end if;

  select e.capacity into v_capacity
  from public.events e
  where e.id = p_event_id;

  if not found then
    return 0;
  end if;

  select count(*) into v_going
  from public.event_rsvps r
  where r.event_id = p_event_id
    and r.status = 'going';

  for v_row in
    select r.id
    from public.event_rsvps r
    where r.event_id = p_event_id
      and r.status = 'waitlist'
    order by r.responded_at, r.id
  loop
    exit when v_capacity is not null and v_going >= v_capacity;

    -- `responded_at` is deliberately NOT touched: it is when this person
    -- joined the queue, and rewriting it would erase the very fact that
    -- justified promoting them ahead of everyone else.
    update public.event_rsvps
       set status = 'going',
           decided_at = now(),
           decided_by = null
     where id = v_row.id
       and status = 'waitlist';

    v_going := v_going + 1;
    v_promoted := v_promoted + 1;
  end loop;

  return v_promoted;
end;
$$;

comment on function private.promote_event_waitlist(uuid) is
  'Promotes waitlisted RSVPs to `going`, oldest first, for as many seats as are '
  'genuinely free. Called inside the same transaction that frees a seat so the '
  'seat is never observably unclaimed. decided_at set with decided_by null marks '
  'these as system promotions rather than host decisions.';

revoke all on function private.promote_event_waitlist(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.request_event_rsvp
-- ---------------------------------------------------------------------------
-- The self-service path: "here is what I would like my answer to be".
--
-- `p_status` is an INTENT, and only the three values a person can truthfully
-- assert about themselves are accepted: `going`, `interested`, `not_going`.
-- Asking directly for `pending`, `waitlist` or `denied` is refused with
-- `invalid_intent` rather than quietly translated, because a caller sending one
-- of those is either broken or probing, and neither deserves a helpful guess.
--
-- The stored value is then computed from the event, never from the request:
--
--   intent `interested` / `not_going`  -> stored as asked. Neither consumes a
--                                          seat nor needs anyone's permission.
--   intent `going`, already `going`     -> stays `going`. Re-affirming must not
--                                          demote somebody a host already
--                                          approved back into `pending`.
--   intent `going`, requires_approval   -> `pending`. The capacity check is not
--                                          even reached: whether there is room
--                                          is the host's problem at decision
--                                          time, and holding a seat for an
--                                          unapproved request would let anyone
--                                          fill an event by requesting.
--   intent `going`, at capacity         -> `waitlist`.
--   otherwise                           -> `going`.
--
-- JUDGMENT CALL — RE-REQUESTING AFTER A DENIAL IS ALLOWED
--   A `denied` row is not terminal here: asking again puts the requester back
--   in `pending` (or on the waitlist, for a non-approval event), and the host
--   decides again. The alternative — `denied` is permanent until a host clears
--   it — was rejected because it makes an ordinary mistake unfixable by the
--   person it affects (a host mis-taps deny; the requester now has no way to
--   ask again, ever) and because circumstances legitimately change. What it
--   costs is that a denial can be nagged at, which is a moderation problem with
--   moderation answers, not a security one: a re-request lands in `pending`,
--   which grants nothing at all until the host acts. Note that re-requesting
--   CLEARS `decided_by`/`decided_at` — those columns describe the row's current
--   status, and leaving a denial's decider attached to a fresh `pending` row
--   would read as "a host approved this", which is worse than losing the
--   history. If a durable decision log is ever wanted, that is a separate
--   append-only table, not two columns doing double duty.
--
-- JUDGMENT CALL — NO NEW `going` RSVP TO AN EVENT THAT HAS ALREADY ENDED
--   Refused with `event_ended`. This is a security narrowing, not tidiness.
--   `private.shares_event_with()` makes two `going` RSVPs to the same event
--   into mutual profile visibility (§3.4). Without this check, every public
--   event in the archive is a standing, permanent invitation: anyone could scan
--   past events, RSVP `going` to one a specific person attended months ago, and
--   read that person's profile — with no attendance, no contact, and nothing
--   the target could notice or refuse. Blocking it does not close the wider
--   `shares_event_with` question (§3.6 still names that branch as the first to
--   re-examine), but it does mean the exposure requires a live, upcoming event
--   both parties are choosing to be at, which is the situation the branch was
--   actually designed for. `interested` and `not_going` are still accepted on a
--   past event — neither grants anything — and withdrawal always is.
create or replace function public.request_event_rsvp(p_event_id uuid, p_status text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_capacity integer;
  v_requires_approval boolean;
  v_ends_at timestamptz;
  v_starts_at timestamptz;
  v_existing_id uuid;
  v_existing_status text;
  v_going integer;
  v_stored text;
  v_rsvp_id uuid;
  v_promoted integer := 0;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_event_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_event');
  end if;

  -- Outcomes are not intents. See the header.
  if p_status is null or p_status not in ('going', 'interested', 'not_going') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_intent');
  end if;

  -- The same gate the dropped INSERT policy applied: you cannot RSVP your way
  -- into visibility of a private event you were never told about.
  if not private.can_see_event(v_user, p_event_id) then
    return jsonb_build_object('ok', false, 'reason', 'event_not_visible');
  end if;

  -- FOR UPDATE on the event row is this feature's capacity lock. Every write
  -- path below takes it, so two people racing for the last seat serialise here
  -- and the second one sees the first one's row — the same compare-under-lock
  -- discipline `create_verified_connection` uses for a session.
  select e.capacity, e.requires_approval, e.starts_at, e.ends_at
    into v_capacity, v_requires_approval, v_starts_at, v_ends_at
  from public.events e
  where e.id = p_event_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'event_not_found');
  end if;

  select r.id, r.status
    into v_existing_id, v_existing_status
  from public.event_rsvps r
  where r.event_id = p_event_id
    and r.user_id = v_user;

  if p_status = 'going'
     and coalesce(v_ends_at, v_starts_at) < now()
     and v_existing_status is distinct from 'going' then
    return jsonb_build_object('ok', false, 'reason', 'event_ended');
  end if;

  if p_status <> 'going' then
    v_stored := p_status;
  elsif v_existing_status = 'going' then
    v_stored := 'going';
  elsif v_requires_approval then
    v_stored := 'pending';
  else
    select count(*) into v_going
    from public.event_rsvps r
    where r.event_id = p_event_id
      and r.status = 'going';

    if v_capacity is not null and v_going >= v_capacity then
      v_stored := 'waitlist';
    else
      v_stored := 'going';
    end if;
  end if;

  -- A no-op is a no-op. Writing anyway would bump `responded_at`, which for a
  -- `waitlist` row means re-tapping the button silently sends you to the back
  -- of the queue you are already in.
  if v_existing_id is not null and v_existing_status = v_stored then
    return jsonb_build_object(
      'ok', true,
      'rsvp_id', v_existing_id,
      'status', v_stored,
      'changed', false,
      'promoted', 0
    );
  end if;

  insert into public.event_rsvps (event_id, user_id, status, responded_at)
  values (p_event_id, v_user, v_stored, now())
  on conflict (event_id, user_id) do update
    set status = excluded.status,
        responded_at = excluded.responded_at,
        -- Cleared because they describe the status being replaced, not the new
        -- one. See the re-request judgment call in the header.
        decided_by = null,
        decided_at = null,
        capacity_override = false
  returning id into v_rsvp_id;

  -- Leaving `going` frees a seat, and the person who should get it is decided
  -- here, in this transaction, not by whoever refreshes first.
  if v_existing_status = 'going' and v_stored <> 'going' then
    v_promoted := private.promote_event_waitlist(p_event_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'rsvp_id', v_rsvp_id,
    'status', v_stored,
    'changed', true,
    'promoted', v_promoted
  );
end;
$$;

comment on function public.request_event_rsvp(uuid, text) is
  'Self-service RSVP. Takes an INTENT (going | interested | not_going) and stores '
  'the status the event''s own rules produce — pending when the host must '
  'approve, waitlist when it is full. The caller is taken from the JWT, never '
  'from an argument, so it cannot act for anyone else. Frees seats and promotes '
  'the waitlist in the same transaction.';

-- ---------------------------------------------------------------------------
-- public.withdraw_event_rsvp
-- ---------------------------------------------------------------------------
-- Removes the caller's answer entirely, and promotes the waitlist if that freed
-- a seat.
--
-- WHY THIS EXISTS SEPARATELY FROM `request_event_rsvp(id, 'not_going')`
--   They record different facts. `not_going` is an answer — "I was asked and I
--   am not coming" — and it is what a host's roster should show. Withdrawal is
--   the absence of an answer, i.e. "forget I said anything", which is the
--   capability the DELETE policy dropped above used to provide directly and
--   which there is no reason to take away from people.
--
-- WHY IT IS AN RPC RATHER THAN THE DELETE GRANT IT REPLACES
--   Precisely because it can free a seat. A plain `DELETE` over PostgREST has
--   no hook that could promote the next person in the same transaction, so the
--   seat would sit visibly empty until somebody happened to call something
--   else. Every path that can free a seat has to be a path that can fill it.
--
-- ALLOWED AFTER AN EVENT HAS ENDED, unlike a new `going` request: removing
-- yourself only ever reduces what anyone can see about you, so there is no
-- version of it that needs to fail closed.
--
-- ONE CONSEQUENCE WORTH STATING: for a PRIVATE event, the RSVP row is what
-- makes the event visible to you at all (`private.can_see_event`). Withdrawing
-- therefore also gives up your ability to see the event. That is correct — it
-- is the same fact from both directions — but it is not obvious, and a UI
-- should say so before calling this.
create or replace function public.withdraw_event_rsvp(p_event_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_deleted_status text;
  v_promoted integer := 0;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_event_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_event');
  end if;

  -- Same capacity lock as every other write path, taken before the delete so a
  -- concurrent request for the freed seat waits rather than races.
  perform 1 from public.events e where e.id = p_event_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'event_not_found');
  end if;

  delete from public.event_rsvps r
  where r.event_id = p_event_id
    and r.user_id = v_user
  returning r.status into v_deleted_status;

  if v_deleted_status is null then
    return jsonb_build_object('ok', false, 'reason', 'no_rsvp');
  end if;

  if v_deleted_status = 'going' then
    v_promoted := private.promote_event_waitlist(p_event_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'withdrew_from_status', v_deleted_status,
    'promoted', v_promoted
  );
end;
$$;

comment on function public.withdraw_event_rsvp(uuid) is
  'Deletes the caller''s own RSVP row and promotes the waitlist in the same '
  'transaction if that freed a seat. Replaces the direct DELETE grant, which '
  'could not promote. For a private event this also gives up visibility of the '
  'event, since the RSVP row is what granted it.';

-- ---------------------------------------------------------------------------
-- public.decide_event_rsvp
-- ---------------------------------------------------------------------------
-- The host path: approve or deny somebody else's request.
--
-- AUTHORIZATION FAILS CLOSED, AND FAILS INDISTINGUISHABLY
--   The RSVP is looked up joined to its event with `host_user_id = caller`, so
--   "no such RSVP" and "not your event" produce the same `rsvp_not_found`
--   answer. That is the posture `getConnectionForViewer` already takes in
--   `connections-service.ts`: telling a non-host that an id exists is not this
--   function's business, and distinguishing the two cases would make it a
--   probe for whether a given RSVP id is real.
--
-- WHICH ROWS ARE DECIDABLE, AND THE JUDGMENT CALL BEHIND IT
--   Only `pending` and `waitlist`. Deliberately NOT `going`, and not `denied`:
--
--     * Deny on an already-`going` row would be an eject — retracting an
--       admission somebody already holds and has planned around. That is a
--       different product action with different consequences (and different
--       notification obligations) from refusing a request, it was not asked
--       for, and inventing it here would mean a host could silently remove
--       someone from an event they believe they are attending. Refused with
--       `not_decidable`. A useful side effect: no decision path can free a
--       seat, which is why this function never needs to promote.
--     * Approve on a `denied` row would let a host reinstate somebody who has
--       not asked to come since being told no — pushing them to `going`, which
--       makes their profile readable to co-attendees via
--       `private.shares_event_with()`, without any act of theirs. The way back
--       from a denial is the requester asking again (see
--       `request_event_rsvp`), which keeps the person's own consent in the
--       loop. A host who mis-taps deny cannot undo it alone; that is the
--       fail-closed direction.
--
-- APPROVAL AT CAPACITY
--   Approving into a full event stores `waitlist`, not `going` — the cap is not
--   silently exceeded just because the host said yes. `p_override => true` is
--   the deliberate escape hatch, and it is recorded: `capacity_override` is set
--   true ONLY when the override actually did something (the event really was
--   full). Passing the flag when there was room is not an override and is not
--   recorded as one, so the column stays a truthful answer to "was a rule set
--   aside for this row" rather than a record of which button was clicked.
--
-- APPROVAL AFTER THE EVENT HAS ENDED is refused, for the same reason
-- `request_event_rsvp` refuses a late `going`: it would mint attendance, and
-- attendance is an input to profile visibility. Denial stays available forever,
-- because denying grants nothing.
create or replace function public.decide_event_rsvp(
  p_rsvp_id uuid,
  p_decision text,
  p_override boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_event_id uuid;
  v_status text;
  v_capacity integer;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_going integer;
  v_stored text;
  v_override_used boolean := false;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if p_rsvp_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_rsvp');
  end if;

  if p_decision is null or p_decision not in ('approve', 'deny') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_decision');
  end if;

  select r.event_id into v_event_id
  from public.event_rsvps r
  join public.events e on e.id = r.event_id
  where r.id = p_rsvp_id
    and e.host_user_id = v_user;

  if not found then
    -- Covers both "no such RSVP" and "not your event" on purpose.
    return jsonb_build_object('ok', false, 'reason', 'rsvp_not_found');
  end if;

  select e.capacity, e.starts_at, e.ends_at
    into v_capacity, v_starts_at, v_ends_at
  from public.events e
  where e.id = v_event_id
  for update;

  -- Re-read the RSVP's status under the event lock. Between the lookup above
  -- and here, the requester could have withdrawn or changed their answer;
  -- deciding on what they used to want would be deciding on nothing.
  select r.status into v_status
  from public.event_rsvps r
  where r.id = p_rsvp_id;

  if v_status is null then
    return jsonb_build_object('ok', false, 'reason', 'rsvp_not_found');
  end if;

  if v_status not in ('pending', 'waitlist') then
    return jsonb_build_object('ok', false, 'reason', 'not_decidable', 'status', v_status);
  end if;

  if p_decision = 'deny' then
    v_stored := 'denied';
  else
    if coalesce(v_ends_at, v_starts_at) < now() then
      return jsonb_build_object('ok', false, 'reason', 'event_ended');
    end if;

    select count(*) into v_going
    from public.event_rsvps r
    where r.event_id = v_event_id
      and r.status = 'going';

    if v_capacity is null or v_going < v_capacity then
      v_stored := 'going';
    elsif coalesce(p_override, false) then
      v_stored := 'going';
      v_override_used := true;
    else
      v_stored := 'waitlist';
    end if;
  end if;

  -- `responded_at` is untouched: it records when the person asked, and the
  -- waitlist is ordered by it. Refreshing it here would let the timing of a
  -- host's decision reshuffle a queue that is supposed to reflect the
  -- requesters' own order.
  update public.event_rsvps r
     set status = v_stored,
         decided_by = v_user,
         decided_at = now(),
         capacity_override = v_override_used
   where r.id = p_rsvp_id;

  return jsonb_build_object(
    'ok', true,
    'rsvp_id', p_rsvp_id,
    'status', v_stored,
    'capacity_override', v_override_used
  );
end;
$$;

comment on function public.decide_event_rsvp(uuid, text, boolean) is
  'Host-only approve/deny of a pending or waitlisted RSVP for the host''s own '
  'event. Approving a full event waitlists rather than silently exceeding the '
  'cap unless the host overrides, which is recorded in capacity_override. '
  'Deny on an already-going row and approve on a denied row are both refused — '
  'see the migration header for why each is the fail-closed direction.';

-- ---------------------------------------------------------------------------
-- public.event_attendance_counts
-- ---------------------------------------------------------------------------
-- The numbers an event page needs — "18 going, 4 interested, 3 waiting, 2 seats
-- left" — for anybody who can already see the event.
--
-- WHY THIS IS A FUNCTION AND NOT A RELAXED POLICY ON `event_rsvps`
--   §3.3's principle, applied to a new question: the database hands back a
--   computed answer, never the rows. `event_rsvps` stays unreadable beyond your
--   own answers and your connections', so RSVPing to a large public event still
--   cannot be used to enumerate who else is there. A count reveals a headcount;
--   the policy that would produce it by relaxation would reveal a guest list,
--   and those are not the same disclosure.
--
--   `pending` is returned only to the host, and null to everyone else. Not
--   because a pending count is dangerous, but because it is the host's queue
--   depth and nobody else's business, and returning nothing is cheaper to
--   justify than returning something nobody asked for.
create or replace function public.event_attendance_counts(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_is_host boolean;
  v_capacity integer;
  v_going integer;
  v_interested integer;
  v_waitlist integer;
  v_pending integer;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  if not private.can_see_event(v_user, p_event_id) then
    return jsonb_build_object('ok', false, 'reason', 'event_not_visible');
  end if;

  v_is_host := private.is_event_host(v_user, p_event_id);

  select e.capacity into v_capacity
  from public.events e
  where e.id = p_event_id;

  select
    count(*) filter (where r.status = 'going'),
    count(*) filter (where r.status = 'interested'),
    count(*) filter (where r.status = 'waitlist'),
    count(*) filter (where r.status = 'pending')
    into v_going, v_interested, v_waitlist, v_pending
  from public.event_rsvps r
  where r.event_id = p_event_id;

  return jsonb_build_object(
    'ok', true,
    'going', v_going,
    'interested', v_interested,
    'waitlist', v_waitlist,
    -- Host-only; see the header.
    'pending', case when v_is_host then v_pending else null end,
    'capacity', v_capacity,
    -- Null seats_remaining means unlimited, matching `capacity`'s own encoding,
    -- rather than a large number that a client would have to know to ignore.
    -- greatest(...) so an over-capacity event (a recorded host override) reads
    -- as "full", never as a negative number of seats.
    'seats_remaining', case when v_capacity is null then null else greatest(v_capacity - v_going, 0) end,
    'is_full', case when v_capacity is null then false else v_going >= v_capacity end
  );
end;
$$;

comment on function public.event_attendance_counts(uuid) is
  'Aggregate attendance for an event the caller can already see: going, '
  'interested, waitlist, capacity and seats remaining, plus the pending count '
  'for the host only. A computed answer, never rows — event_rsvps stays '
  'unreadable so an event cannot be used to enumerate its attendees (§3.3).';

-- ---------------------------------------------------------------------------
-- public.event_rsvp_queue
-- ---------------------------------------------------------------------------
-- The host's roster for their own event: who is coming, who is waiting, and who
-- is asking. Returns no rows to anyone who is not the host — no error, no
-- distinction between "not your event" and "no such event".
--
-- THIS IS A REAL, DELIBERATE DISCLOSURE, AND HERE IS ITS EXACT SHAPE
--   It returns profile fields (name, username, photo path) for people the
--   caller may not otherwise be able to read, because `public.users`'s policy
--   (§3.4) would only allow it for a connection or a co-`going` attendee. A
--   host cannot approve a request from a name they cannot see — a decision
--   about an anonymous id is not a decision — so the feature genuinely
--   requires this.
--
--   Two alternatives were considered and rejected:
--
--     * Adding a branch to the `users` read policy ("you may read anyone who
--       has an RSVP on an event you host"). Rejected: §3.4 is the policy that
--       structurally forbids global search, every branch of it is load-bearing,
--       and a branch there would apply to EVERY query against `users` from
--       anywhere in the app forever — a reusable visibility predicate, when
--       what is needed is one screen's worth of names.
--     * Showing the host bare user ids. Rejected as a non-feature: it does not
--       let a host do the one thing approval exists for.
--
--   So the disclosure is contained in a function instead of spread into a
--   policy: it answers one question, for one role, about one event, and it
--   cannot be composed into anything else. That is the §3.3 pattern
--   (`connections_attending`) reused for a question with a different subject.
--
--   The rows it returns are narrowed to the people who are actually asking to
--   be at the event: `pending`, `waitlist`, `going`. Deliberately excluded:
--     `interested` — a curiosity tap must not hand your identity to a stranger
--                    who happens to have created an event, which is the same
--                    line `private.shares_event_with()` draws (§3.6);
--     `not_going`  — you answered no, and that answer should not cost you more
--                    than saying nothing would have;
--     `denied`     — the host has already decided about you, and a decision
--                    against someone is not a reason to keep reading them.
--   All four counts are still available to the host through
--   `event_attendance_counts`, which discloses no identities.
create or replace function public.event_rsvp_queue(p_event_id uuid)
returns table (
  rsvp_id uuid,
  user_id uuid,
  status text,
  responded_at timestamptz,
  decided_at timestamptz,
  decided_by uuid,
  capacity_override boolean,
  first_name text,
  last_name text,
  username text,
  photo_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    r.user_id,
    r.status,
    r.responded_at,
    r.decided_at,
    r.decided_by,
    r.capacity_override,
    u.first_name,
    u.last_name,
    u.username,
    u.photo_path
  from public.event_rsvps r
  join public.users u on u.id = r.user_id
  where private.is_event_host(private.current_user_id(), p_event_id)
    and r.event_id = p_event_id
    and r.status in ('pending', 'waitlist', 'going')
  -- Pending first (the queue that needs action), then the order people asked in
  -- — which is also the order the waitlist will actually be promoted in, so the
  -- host sees the real queue rather than a differently-sorted view of it.
  order by
    case r.status when 'pending' then 0 when 'waitlist' then 1 else 2 end,
    r.responded_at,
    r.id;
$$;

comment on function public.event_rsvp_queue(uuid) is
  'The host''s own roster: pending, waitlisted and going RSVPs with the profile '
  'fields needed to decide on them. Empty for everyone who is not the host. A '
  'contained disclosure — see the migration header for why this is a function '
  'rather than a branch of the users read policy.';

-- ---------------------------------------------------------------------------
-- Capacity changes reopen the waitlist
-- ---------------------------------------------------------------------------
-- A host raising capacity from 10 to 20, or clearing it entirely, creates ten
-- (or unlimited) free seats. Without this trigger the waitlist would sit there
-- while the event visibly had room — the same "a seat exists and belongs to
-- nobody" state `promote_event_waitlist`'s header explains, just arrived at by
-- a different route. The host UPDATE is a plain RLS-checked write with no RPC
-- to hook, so the hook has to live in the database.
--
-- Only ever promotes. LOWERING capacity below the current headcount does NOT
-- demote anybody: an admission already given is not taken back by an edit to a
-- number, and the resulting over-capacity event is exactly the state
-- `capacity_override` was designed to make legible.
--
-- `security definer` because the promotion writes `event_rsvps`, on which the
-- host — like every client role after this migration — holds no UPDATE
-- privilege at all. Trigger functions are permission-checked when the trigger
-- is created rather than when it fires (the same property recorded for
-- `users_set_updated_at` in 20260809211400), so no client grant is needed or
-- given.
create or replace function private.tg_events_promote_waitlist()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- Room may have appeared only if the cap was lifted entirely or raised.
  -- (A safe over-call would be harmless — promote_event_waitlist re-checks
  -- capacity itself — but being explicit here documents the intent.)
  if new.capacity is null
     or (old.capacity is not null and new.capacity > old.capacity) then
    perform private.promote_event_waitlist(new.id);
  end if;
  return null;
end;
$$;

comment on function private.tg_events_promote_waitlist() is
  'AFTER UPDATE hook on events.capacity: fills newly-created seats from the '
  'waitlist in the same transaction as the capacity change. Never demotes on a '
  'capacity reduction — an admission already granted is not withdrawn by editing '
  'a number.';

revoke all on function private.tg_events_promote_waitlist() from public, anon, authenticated;

create trigger events_promote_waitlist_after_capacity_change
after update of capacity on public.events
for each row
when (new.capacity is distinct from old.capacity)
execute function private.tg_events_promote_waitlist();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE on a new function to PUBLIC by default, and PUBLIC
-- includes `anon`. Every function is therefore revoked first and then granted
-- back to exactly one role, the same belt-and-braces order 20260809210900 uses.
revoke all on function public.request_event_rsvp(uuid, text) from public, anon, authenticated;
revoke all on function public.withdraw_event_rsvp(uuid) from public, anon, authenticated;
revoke all on function public.decide_event_rsvp(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.event_attendance_counts(uuid) from public, anon, authenticated;
revoke all on function public.event_rsvp_queue(uuid) from public, anon, authenticated;

grant execute on function public.request_event_rsvp(uuid, text) to authenticated;
grant execute on function public.withdraw_event_rsvp(uuid) to authenticated;
grant execute on function public.decide_event_rsvp(uuid, text, boolean) to authenticated;
grant execute on function public.event_attendance_counts(uuid) to authenticated;
grant execute on function public.event_rsvp_queue(uuid) to authenticated;
