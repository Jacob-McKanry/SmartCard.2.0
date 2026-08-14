-- =============================================================================
-- 20260814190000_fn_event_attendance_counts_connections_made.sql
--
-- WHAT THIS CHANGES
--   One field. `public.event_attendance_counts(p_event_id uuid)` — created by
--   20260814051200 — now also returns `connections_made`: how many verified
--   meetings are tagged to this event.
--
--     count(*) from public.meetings where event_id = p_event_id
--
--   Nothing else about the function changes: same signature, same caller
--   derivation, same `can_see_event` gate, same host-only `pending`, same
--   grants. `create or replace` rather than a new function, so every existing
--   caller picks the field up without a second RPC round trip and there is
--   exactly one definition of "the numbers this event page shows".
--
-- WHY THE NUMBER IS WORTH RETURNING AT ALL
--   `meetings.event_id` has existed since 20260809210500 and until now nothing
--   read it in aggregate. "23 people met someone new here" is the one honest
--   measure of whether an event did the thing this product exists to do, and it
--   is the number a host wants when deciding whether to run the event again.
--
-- WHY IT IS SAFE FOR THE SAME AUDIENCE THE REST OF THE FUNCTION SERVES
--   The function's audience is set by the `private.can_see_event()` check at the
--   top, unchanged: any authenticated user for a public event (§2.6's deliberate
--   exception), plus the host, RSVP holders and invitees for a private one. This
--   field is disclosed to exactly that audience and no wider.
--
--   It is the same privacy shape as `going` / `interested` / `waitlist`, which
--   that audience already gets: a headcount, not a roster. §3.3's rule is that
--   the database hands back a computed answer rather than the rows behind it,
--   and a single integer names nobody, pairs nobody with anybody, and cannot be
--   composed into an attendee list. The rows it is computed from stay exactly as
--   unreadable as they were — `meetings` is still governed by
--   `private.can_see_meeting()` (participants, plus mutuals-of-both on a meeting
--   nobody marked private), and this migration adds no grant, no policy and no
--   new readable row anywhere.
--
-- WHY IT IS *NOT* HOST-GATED, UNLIKE `pending`
--   `pending` is withheld from non-hosts because queue depth is a fact about the
--   host's own decision backlog — it is nobody else's business, and 20260814051200
--   took the view that returning nothing is cheaper to justify than returning
--   something nobody asked for. A connections-made count is not a fact about any
--   individual: it does not say who is waiting on whom, who was admitted, or who
--   is who. It is a property of the event. Gating it would suggest it carries
--   personal information that it does not carry.
--
-- WHY PRIVATE MEETINGS STILL COUNT — THE NON-OBVIOUS DECISION HERE
--   The count is over every meeting tagged to the event, including ones where
--   `meetings.is_private` is true or a participant set `marked_private`. That
--   looks at first glance like it overrides a privacy control, and it is worth
--   being explicit that it does not, and that the alternative is the worse one.
--
--   Those flags control *whether a third party may see that a particular meeting
--   between two particular people happened* — that is what `can_see_meeting`
--   decides, and this function does not disclose any of it. What excluding
--   private meetings would actually build is a side channel about the flags
--   themselves: the number would then move whenever somebody toggled their
--   privacy setting, so anyone polling this RPC could watch it drop by one and
--   learn that a participant at this event had just marked their meeting
--   private. A count that responds to privacy toggles leaks the toggles. A count
--   over all meetings is inert and leaks nothing.
--
--   The honest residual: at an event with very few meetings the number is small,
--   and a viewer who already knows most of the room could reason about it. That
--   is the same small-N inference the existing `going` count already permits,
--   it discloses no identity that the RSVP counts do not, and it is not made
--   materially worse by this field.
--
-- WHY IT COUNTS MEETINGS AND NOT `active` CONNECTIONS
--   Deliberate. A meeting is the historical fact — two people met here, and it
--   was verified. A connection is the relationship that fact created, and either
--   party may later set it to `removed` (20260809211200). Counting live
--   connections would make an event's history rewritable after the fact by
--   people leaving each other's graphs months later, and would also mean the
--   number quietly reports how many pairs fell out. `meetings` is one row per
--   verified in-person contact and never moves. Note the direct consequence: the
--   event-level number here and the caller's own per-event number computed by
--   `getOwnConnectionsAtEvent` in events-service.ts (which walks the caller's
--   *active* connections) answer slightly different questions and may legitimately
--   disagree. Both are correct; the difference is documented in both places.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   GRANTED:     nothing new. No table grant, no policy, no new function.
--   FORBIDDEN:   unchanged. `meetings`, `connections` and `event_rsvps` keep the
--                exact select policies they had before this file ran.
--   The revoke/grant pair at the bottom is a restatement, not a change —
--   `create or replace` preserves a function's existing ACL. It is repeated for
--   the same belt-and-braces reason 20260809210900 and 20260814051200 give: the
--   privilege a `security definer` function holds should be visible in the same
--   file as its body, so a future reader never has to go and check whether an
--   earlier migration is still the last word on who may call this.
-- =============================================================================

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
  v_connections_made integer;
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

  -- Every meeting the verifier tagged to this event. Runs underneath RLS like
  -- the rest of this function, which is the point: the answer is the event's
  -- real total rather than the subset this particular caller could have seen,
  -- and no meeting row escapes the function. See the header for why private
  -- meetings are included and why this counts meetings rather than connections.
  -- `meetings_event_id_idx` (20260809210500) serves this lookup.
  select count(*) into v_connections_made
  from public.meetings m
  where m.event_id = p_event_id;

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
    'is_full', case when v_capacity is null then false else v_going >= v_capacity end,
    -- Visible to everyone who can see the event, unlike `pending`. A headcount
    -- of verified meetings that happened here; it identifies nobody.
    'connections_made', v_connections_made
  );
end;
$$;

comment on function public.event_attendance_counts(uuid) is
  'Aggregate attendance for an event the caller can already see: going, '
  'interested, waitlist, capacity and seats remaining, plus connections_made — '
  'how many verified meetings are tagged to this event — and the pending count '
  'for the host only. A computed answer, never rows — event_rsvps and meetings '
  'both stay unreadable, so an event cannot be used to enumerate who was at it '
  'or who met whom (§3.3).';

-- A restatement of the privileges this function already holds, not a change to
-- them. See "ACCESS GRANTED / FORBIDDEN" in the header.
revoke all on function public.event_attendance_counts(uuid) from public, anon, authenticated;
grant execute on function public.event_attendance_counts(uuid) to authenticated;
