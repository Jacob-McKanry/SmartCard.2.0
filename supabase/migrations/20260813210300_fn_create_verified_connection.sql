-- =============================================================================
-- 20260813210300_fn_create_verified_connection.sql
--
-- WHAT THIS CHANGES
--   Creates `public.create_verified_connection(...)`, the single atomic write
--   behind `createVerifiedConnection()` in packages/core (§4.1).
--
-- WHY THIS IS A DATABASE FUNCTION AT ALL — THE ATOMICITY PROBLEM
--   §4.2 step 6 says "commit atomically", and that phrase is doing real security
--   work rather than describing tidiness. supabase-js has no client-side
--   multi-statement transaction: six sequential PostgREST calls are six
--   independent transactions, and any of them can be the last one that runs.
--   The partial states that produces are not cosmetic:
--     * meeting written, session NOT consumed  -> the session is still `active`
--       and every outstanding token is still live. That is §4.7 threat 1
--       reopened by a dropped connection.
--     * session consumed, connection NOT written -> two people who really met
--       are told it worked and have no edge, with the session burned.
--     * connection written, participants NOT written -> `meeting_party()`
--       returns null and §3.2's location policy, written to fail closed on
--       exactly that, denies the participants their own meeting.
--   A `plpgsql` function runs inside one transaction by construction, so every
--   statement below commits together or none of them does.
--
-- WHY `security invoker`, WHICH DEPARTS FROM THE §3.1 HELPERS
--   Every helper in `private` is `security definer` because a POLICY needs to
--   see rows the CALLER may not. Nothing of the kind is true here: the only
--   caller is the service role, which already bypasses RLS.
--   As `security definer`, this function would be a single grantable capability
--   to manufacture arbitrary connections with the table owner's rights — one
--   mistaken `grant execute ... to authenticated` away from being exactly the
--   "second path that writes connections" §4.7 threat 4 forbids. As `security
--   invoker`, that same mistaken grant lands on a role holding no INSERT
--   privilege on connections/meetings/meeting_participants/meeting_locations,
--   and the first insert fails. The absent INSERT policy stays the backstop it
--   was designed to be instead of being bypassed by the function meant to
--   respect it.
--
-- WHY IT RE-VALIDATES WHAT THE SERVICE LAYER ALREADY CHECKED
--   Between the TypeScript check and the write there is a gap in which the
--   world can change — someone can block, or a concurrent redeem can connect
--   the same pair. Re-testing inside the transaction that does the write is the
--   only way those answers are still true when the row lands.
--
-- WHY IT RETURNS A REASON INSTEAD OF RAISING
--   A raise would roll the transaction back, discarding any rejection we tried
--   to log inside it. So every refusal happens BEFORE the first write and
--   returns {ok:false, reason}; the caller logs that rejection separately.
--
-- ACCESS GRANTED / FORBIDDEN
--   EXECUTE revoked from PUBLIC, `anon` and `authenticated`; granted to
--   `service_role` alone. Do not grant EXECUTE to `authenticated` to "let the
--   client call it directly" — that is the second write path §4.7 threat 4 says
--   must never exist.
-- =============================================================================

create or replace function public.create_verified_connection(
  p_method text,
  p_presenter_user_id uuid,
  p_scanner_user_id uuid,
  p_session_id uuid,
  p_occurred_at timestamptz,
  p_event_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_distance_m double precision,
  p_scanner_accuracy_m double precision,
  p_presenter_accuracy_m double precision,
  p_radius_config_used_m double precision,
  p_accuracy_config_used_m double precision,
  p_radius_mode text,
  p_relaxation_source_attempt_id uuid,
  p_ip_hash text,
  p_user_agent text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_session_id uuid := p_session_id;
  v_meeting_id uuid;
  v_connection_id uuid;
  v_attempt_id uuid;
  v_existing_id uuid;
  v_existing_status text;
  v_user_a uuid;
  v_user_b uuid;
  v_reconnected boolean := false;
  v_consumed integer;
begin
  -- Argument sanity. A null here is a bug in the caller, and a bug in the
  -- caller on this path must refuse rather than write something ambiguous.
  if p_method is null or p_method not in ('qr_gps', 'nfc_card') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_method');
  end if;

  if p_presenter_user_id is null or p_scanner_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_party');
  end if;

  -- Self-connect. Also enforced by a CHECK on connection_sessions and made
  -- impossible by the ordered-pair CHECK on connections (a = b cannot satisfy
  -- a < b), so this is the third independent place it is refused.
  if p_presenter_user_id = p_scanner_user_id then
    return jsonb_build_object('ok', false, 'reason', 'self_connect');
  end if;

  -- Blocks, in BOTH directions, re-checked here for the TOCTOU reason above.
  if exists (
    select 1 from public.blocks b
    where (b.blocker_user_id = p_presenter_user_id and b.blocked_user_id = p_scanner_user_id)
       or (b.blocker_user_id = p_scanner_user_id and b.blocked_user_id = p_presenter_user_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;

  -- Canonical pair order — the smaller uuid is always user_a (§2.3). Computed
  -- here rather than trusted from the caller, so the ordered-pair CHECK can
  -- never be tripped by a caller that got it backwards.
  v_user_a := least(p_presenter_user_id, p_scanner_user_id);
  v_user_b := greatest(p_presenter_user_id, p_scanner_user_id);

  -- FOR UPDATE: if two redeems for the same pair race, the second waits here
  -- and then sees the first one's row, instead of both inserting.
  select c.id, c.status
    into v_existing_id, v_existing_status
  from public.connections c
  where c.user_a_id = v_user_a and c.user_b_id = v_user_b
  for update;

  if v_existing_id is not null and v_existing_status = 'active' then
    return jsonb_build_object('ok', false, 'reason', 'already_connected');
  end if;

  -- Consume the session. This is the single-use enforcement point, and it is a
  -- compare-and-swap on purpose: a check followed by a write is not single-use,
  -- because two scans arriving together both read `active`. Folding the test
  -- into the UPDATE's WHERE clause makes the database the arbiter — exactly one
  -- of them updates a row. That is what makes "consuming the session kills every
  -- outstanding token" (§4.2 step 6, §4.7 threat 1) true under concurrency
  -- rather than merely usually. The predicate also re-pins the presenter and the
  -- method.
  if v_session_id is not null then
    update public.connection_sessions s
       set status = 'consumed',
           consumed_at = v_now,
           consumed_by_user_id = p_scanner_user_id
     where s.id = v_session_id
       and s.status = 'active'
       and s.expires_at > v_now
       and s.presenter_user_id = p_presenter_user_id
       and s.method = p_method
       and s.presenter_user_id <> p_scanner_user_id;

    get diagnostics v_consumed = row_count;
    if v_consumed <> 1 then
      return jsonb_build_object('ok', false, 'reason', 'session_not_consumable');
    end if;
  else
    -- NFC has no presented session to consume, but `meetings.verification_
    -- session_id` is NOT NULL and UNIQUE, and §3.6's judgment call on that
    -- constraint is explicit: "if the NFC redeem path is later built without
    -- creating a session, create the session — do not drop the constraint."
    -- One is created here, already in its terminal state, inside the same
    -- transaction: born `consumed`, with expires_at already past, so there is
    -- no instant at which anything could redeem it.
    if p_method <> 'nfc_card' then
      return jsonb_build_object('ok', false, 'reason', 'missing_session');
    end if;

    insert into public.connection_sessions
      (method, presenter_user_id, status, expires_at, consumed_at, consumed_by_user_id)
    values
      ('nfc_card', p_presenter_user_id, 'consumed', v_now, v_now, p_scanner_user_id)
    returning id into v_session_id;
  end if;

  -- The graph write. Wrapped so a unique violation from a concurrent redeem of
  -- a DIFFERENT session for the same pair rolls this block back and returns a
  -- reason rather than propagating a raw 23505.
  begin
    insert into public.meetings
      (occurred_at, verification_method, verification_session_id, event_id)
    values
      (coalesce(p_occurred_at, v_now), p_method, v_session_id, p_event_id)
    returning id into v_meeting_id;

    -- Both participants, with consent defaulting to false as §2.4 requires:
    -- sharing a meeting's location with mutuals is an affirmative act by every
    -- participant afterwards, and nothing here may pre-consent on their behalf.
    insert into public.meeting_participants (meeting_id, user_id)
    values (v_meeting_id, p_presenter_user_id), (v_meeting_id, p_scanner_user_id);

    -- Location only when a fix was actually captured AND complete. Absence of a
    -- location is represented by the absence of the row (§2.4) — the permanent
    -- state for every nfc_card meeting. Requiring all three columns means a
    -- partial fix produces no row rather than a row asserting a position with
    -- unknown precision.
    if p_latitude is not null and p_longitude is not null and p_accuracy_m is not null then
      insert into public.meeting_locations (meeting_id, latitude, longitude, accuracy_m)
      values (v_meeting_id, p_latitude, p_longitude, p_accuracy_m);
    end if;

    if v_existing_id is null then
      insert into public.connections (user_a_id, user_b_id, origin_meeting_id)
      values (v_user_a, v_user_b, v_meeting_id)
      returning id into v_connection_id;
    else
      -- The row exists and is `removed` — the pair connected once, someone
      -- removed it, and they have now met again and verified again.
      --
      -- Why this does not contradict the RLS rule that forbids re-activation:
      -- 20260809211200 makes removed -> active impossible FOR A CLIENT, because
      -- a client doing it would produce a live edge with no fresh verification
      -- behind it — "an INSERT by another verb". Here there IS fresh
      -- verification: a new session, a new meeting, and (for QR) a new pair of
      -- in-range GPS fixes, all created moments ago in this transaction.
      -- origin_meeting_id is repointed at that new meeting so the edge keeps
      -- naming the evidence that currently justifies it, and created_at is reset
      -- because this connection dates from this meeting, not from a
      -- relationship that was deliberately ended.
      --
      -- The alternative — refusing, because a UNIQUE constraint exists on the
      -- pair — would mean two people who removed a connection could never
      -- reconnect no matter how many times they met. That is a product bug, not
      -- a security property.
      update public.connections c
         set status = 'active',
             origin_meeting_id = v_meeting_id,
             created_at = v_now
       where c.id = v_existing_id;
      v_connection_id := v_existing_id;
      v_reconnected := true;
    end if;

    -- The audit row, written inside the same transaction as the thing it
    -- attests to. A success that is not logged, or a log entry for a write that
    -- rolled back, would both corrupt the dataset §4.4 tunes the radius from.
    insert into public.connection_attempts (
      session_id, method, scanner_user_id, presenter_user_id,
      outcome, rejection_reason,
      distance_m, scanner_accuracy_m, presenter_accuracy_m,
      radius_config_used_m, accuracy_config_used_m,
      radius_mode, relaxation_source_attempt_id,
      ip_hash, user_agent
    ) values (
      v_session_id, p_method, p_scanner_user_id, p_presenter_user_id,
      'success', null,
      p_distance_m, p_scanner_accuracy_m, p_presenter_accuracy_m,
      p_radius_config_used_m, p_accuracy_config_used_m,
      coalesce(p_radius_mode, 'normal'), p_relaxation_source_attempt_id,
      p_ip_hash, p_user_agent
    )
    returning id into v_attempt_id;

  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'reason', 'already_connected');
  end;

  return jsonb_build_object(
    'ok', true,
    'connection_id', v_connection_id,
    'meeting_id', v_meeting_id,
    'session_id', v_session_id,
    'attempt_id', v_attempt_id,
    'reconnected', v_reconnected
  );
end;
$$;

comment on function public.create_verified_connection(
  text, uuid, uuid, uuid, timestamptz, uuid,
  double precision, double precision, double precision,
  double precision, double precision, double precision,
  double precision, double precision, text, uuid, text, text
) is
  'The single atomic graph write behind createVerifiedConnection() (§4.1, §4.2 '
  'step 6). Consumes the session by compare-and-swap, writes meeting + '
  'participants + optional location + connection + audit row in one transaction. '
  'service_role only; deliberately security INVOKER so a mis-granted EXECUTE '
  'still hits the absent INSERT policies rather than bypassing them.';

revoke all on function public.create_verified_connection(
  text, uuid, uuid, uuid, timestamptz, uuid,
  double precision, double precision, double precision,
  double precision, double precision, double precision,
  double precision, double precision, text, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.create_verified_connection(
  text, uuid, uuid, uuid, timestamptz, uuid,
  double precision, double precision, double precision,
  double precision, double precision, double precision,
  double precision, double precision, text, uuid, text, text
) to service_role;
