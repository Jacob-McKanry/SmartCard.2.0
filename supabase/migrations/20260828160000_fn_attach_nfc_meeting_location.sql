-- =============================================================================
-- 20260828160000_fn_attach_nfc_meeting_location.sql
--
-- WHAT THIS CHANGES
--   Adds `public.attach_nfc_meeting_location(uuid, float8, float8, float8,
--   timestamptz)` — the first and only write path that lets an `authenticated`
--   caller put a row into `public.meeting_locations`. Adds two `app_config`
--   rows. No table changes, no policy changes, no existing function touched.
--
-- ===========================================================================
-- WHY THIS EXISTS, AND THE DESIGN DECISION IT IS DELIBERATELY NOT REVERSING
-- ===========================================================================
--   §4.5 and `nfc-verifier.ts` are emphatic that a card tap has NO GPS GATE:
--   NFC's few-centimetre read range IS the proximity proof, and a better one
--   than GPS because it cannot be spoofed from another city. THAT IS
--   UNCHANGED BY THIS MIGRATION AND MUST STAY UNCHANGED. Nothing below
--   decides whether a connection may exist. By the time anything here runs,
--   the meeting, the connection and the participants have already been
--   written by `create_verified_connection` (20260813210300) on the strength
--   of the tap alone, exactly as before.
--
--   What this adds is DISPLAY DATA, after the fact, for a meeting that
--   already happened: the owner asked (2026-08-28) that a tap be able to show
--   "met at ___" and count toward the profile's city history, the same way a
--   QR-verified meeting already does. `meeting_locations` was previously
--   described as permanently absent for `nfc_card` meetings; that description
--   followed from "no GPS gate", but the two are not the same claim. "We do
--   not GATE on a position" and "we never RECORD a position" are different
--   statements, and only the first is load-bearing for §4.5's security
--   argument.
--
-- ===========================================================================
-- WHY A `security definer` FUNCTION AND NOT THE SERVICE ROLE IN TYPESCRIPT
-- ===========================================================================
--   `meeting_locations` has no INSERT policy and no INSERT grant for any
--   client role, on purpose (20260809211200, and that table's own comment:
--   "rows here are written only by the verification service"). So an
--   `authenticated` caller cannot reach it directly, which is correct and
--   stays correct.
--
--   The alternative was doing this in TypeScript with the service role, as
--   `geocodeMeetingLocation` already does for `place_label`. Rejected, and
--   the difference from that precedent is the whole reason: `geocode` is
--   handed a meeting id the server itself just created moments earlier in the
--   same request — no caller ever names it. Here the caller supplies the
--   meeting id, so a service-role write would make one TypeScript `if` the
--   only thing standing between any signed-in user and writing a position
--   onto ANY meeting in the database. That is precisely the single-lock shape
--   this schema avoids everywhere else. As a `security definer` function, the
--   ownership test is re-derived from `private.current_user_id()` inside the
--   same statement that writes, and the caller supplies nothing that can move
--   it.
--
--   This follows `claim_event_import` (20260828130000) rather than
--   `create_verified_connection` (20260813210300). The latter is
--   `security invoker`/service-role-only and its header warns at length
--   against `security definer` — but that warning is about a function that
--   MANUFACTURES CONNECTIONS, where a mistaken `grant ... to authenticated`
--   would hand out the power to forge the social graph. This function cannot
--   create a meeting, a connection, a participant or a session; the worst a
--   mistaken grant could do is let somebody attach coordinates to their own
--   already-real meeting, which is what it is for.
--
-- ===========================================================================
-- THE FIVE GATES, AND WHAT EACH ONE STOPS
-- ===========================================================================
--   1. CALLER IS THE PERSON WHO TAPPED. Not merely a participant — the
--      tapper specifically, read as `connection_sessions.consumed_by_user_id`
--      (which 20260813210300 sets to the scanner/tapper for the session it
--      creates for every NFC meeting). The card's OWNER took no action and
--      was not necessarily holding a phone at all, so a position they
--      reported would be a position they never claimed to be at. Stops: any
--      user attaching a location to a meeting that is not theirs.
--   2. `nfc_card` ONLY. A `qr_gps` meeting's location came through §4.3's
--      proximity gate; letting this function touch one would mean an
--      unverified, self-reported fix could overwrite a gate-verified record.
--      Stops: laundering a spoofed position into a gate-verified meeting.
--   3. ONE LOCATION, EVER. `on conflict (meeting_id) do nothing` — see below
--      for why this is one statement rather than a check plus an insert.
--      Stops: rewriting a meeting's history, and two concurrent attaches.
--   4. THE MEETING IS RECENT. `occurred_at` must be inside
--      `nfc_location_attach_window_seconds`. A tap's location is only
--      meaningful if it is reported from roughly where and when the tap
--      happened; without this, someone could attach today's position to a
--      meeting from last year. Stops: retroactive geography.
--   5. THE FIX IS RECENT AND NOT FROM THE FUTURE. Same window, applied to
--      `p_captured_at`, plus a hard refusal of a timestamp ahead of the
--      server's clock — the same posture `gps-gate.ts` takes for the QR path,
--      where a future-dated fix must not read as maximally fresh. Stops:
--      holding an old fix and posting it late.
--
--   A rate limit runs BEFORE all five, keyed on the caller, so that probing
--   meeting ids is not free even though every refusal is identical.
--
-- ===========================================================================
-- WHY THE INSERT IS ONE STATEMENT WITH `on conflict do nothing`
-- ===========================================================================
--   The obvious shape is "select to check no row exists, then insert". That
--   has a race: two attaches for the same meeting can both pass the check and
--   the second gets a raw 23505 primary-key violation, which would surface as
--   a 500 rather than as this function's own refusal shape. `on conflict
--   (meeting_id) do nothing` collapses the check and the write into one
--   statement the database decides, which is the same reasoning
--   `claim_event_import`'s single `UPDATE ... where claimed_by_user_id is
--   null` and `claim_unassigned_card`'s `status = 'unassigned'` already use.
--   Realistically the racing pair is one person's phone retrying, not an
--   attack — but a retry that 500s is still a bug, and the atomic form has no
--   downside.
--
-- ===========================================================================
-- WHY EVERY REFUSAL RETURNS THE IDENTICAL SHAPE
-- ===========================================================================
--   `{attached: false}` for all of: no such meeting, not your meeting, a QR
--   meeting, already located, too old, a bad fix, rate-limited, and missing
--   config. Same reasoning as `CardClaimResult` and `claim_event_import`:
--   telling a caller WHICH gate refused turns this into an oracle for which
--   meeting ids exist and who was in them. The caller has no decision to make
--   on the answer either way — this is best-effort decoration on a connection
--   that already committed — so there is nothing a reason would let them do.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Config, seeded rather than hardcoded — same argument as every other
-- app_config threshold: a number that needs a deploy to change is a number
-- nobody changes when it turns out to be wrong.
--
-- NOT added to `CONNECT_CONFIG_KEYS` (packages/core/src/connect/config.ts),
-- deliberately. That list is closed and `parseVerificationConfig` refuses the
-- ENTIRE connect flow if any one of its keys is missing — correct for the
-- thresholds that decide whether people can connect, and badly wrong for
-- these two, where a missing row should cost a cosmetic place label and
-- nothing else. This function reads them itself, exactly as
-- `get_claimable_import` reads its own two.
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value, description) values
  ('nfc_location_attach_window_seconds', '300'::jsonb,
   'How long after a card tap its location may still be attached, in seconds, and equally how old the GPS fix itself may be. Five minutes: comfortably longer than the few seconds the real client takes (it fires the redeem and the location request together and attaches as soon as both land), while short enough that a position reported long after the fact — from somewhere else entirely — cannot be recorded as where the tap happened. This is not a security gate; a tap connects with no location at all. It bounds how wrong the DISPLAYED place can be.'),

  ('rate_limit_nfc_location_attach_per_user_hour', '60'::jsonb,
   'Maximum attach_nfc_meeting_location calls one account may make per hour. A real client calls this at most once per tap and only on success, so this mostly bounds an account being used to probe meeting ids. Sits above rate_limit_nfc_redeem_per_user_hour so a person genuinely tapping at their limit is never additionally refused here, plus headroom for a client that retries.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- public.attach_nfc_meeting_location
-- ---------------------------------------------------------------------------
create or replace function public.attach_nfc_meeting_location(
  p_meeting_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_captured_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_window_seconds integer;
  v_per_user_limit integer;
  v_now timestamptz := now();
  v_meeting_id uuid;
  v_inserted integer;
begin
  if v_user is null then
    return jsonb_build_object('attached', false);
  end if;

  select (value #>> '{}')::integer into v_window_seconds
    from public.app_config where key = 'nfc_location_attach_window_seconds';
  select (value #>> '{}')::integer into v_per_user_limit
    from public.app_config where key = 'rate_limit_nfc_location_attach_per_user_hour';

  -- Fail closed (CLAUDE.md): a missing config row refuses rather than running
  -- with no window or no limit. The cost of failing closed here is one absent
  -- place label, which is exactly the cost §2.4 already accepts for a failed
  -- geocode.
  if v_window_seconds is null or v_per_user_limit is null then
    return jsonb_build_object('attached', false);
  end if;

  -- Before anything is resolved, so a refused or probing call still spends
  -- its budget — same posture as claim_unassigned_card and claim_event_import.
  if not public.rate_limit_consume(
       'nfc_location_attach', 'user', v_user::text, v_per_user_limit, 3600) then
    return jsonb_build_object('attached', false);
  end if;

  -- Shape, before the lookup. These bounds are the same ones
  -- `meeting_locations`' own CHECK constraints enforce; testing them here
  -- means a malformed fix returns this function's ordinary refusal instead of
  -- a raw 23514 the caller would see as a 500. `p_accuracy_m` is additionally
  -- required to be present and finite: the column is NOT NULL because a
  -- position with unknown precision is not a position (§2.4).
  if p_latitude is null or p_longitude is null or p_accuracy_m is null
     or p_captured_at is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180
     or p_accuracy_m < 0
     or p_latitude <> p_latitude or p_longitude <> p_longitude
     or p_accuracy_m <> p_accuracy_m then
    return jsonb_build_object('attached', false);
  end if;

  -- Gate 5. A fix from the future is refused outright rather than treated as
  -- maximally fresh — `gps-gate.ts` makes the same call on the QR path, and
  -- for the same reason: the clock is the caller's, not ours.
  if p_captured_at > v_now
     or p_captured_at < v_now - make_interval(secs => v_window_seconds) then
    return jsonb_build_object('attached', false);
  end if;

  -- Gates 1, 2 and 4, in one lookup. `consumed_by_user_id` is the tapper for
  -- every NFC session (20260813210300 writes it that way); `presenter_user_id`
  -- is the card's owner and deliberately does NOT satisfy this test.
  select m.id into v_meeting_id
    from public.meetings m
    join public.connection_sessions s on s.id = m.verification_session_id
   where m.id = p_meeting_id
     and m.verification_method = 'nfc_card'
     and s.consumed_by_user_id = v_user
     and m.occurred_at > v_now - make_interval(secs => v_window_seconds)
     and m.occurred_at <= v_now;

  if v_meeting_id is null then
    return jsonb_build_object('attached', false);
  end if;

  -- Gate 3, atomically. See the header for why this is not a check plus an
  -- insert. `place_label` is left null on purpose: it is written afterwards by
  -- `geocodeMeetingLocation`, the same second step a QR meeting's label goes
  -- through, so there is one implementation of "turn a fix into a name".
  insert into public.meeting_locations (meeting_id, latitude, longitude, accuracy_m)
  values (v_meeting_id, p_latitude, p_longitude, p_accuracy_m)
  on conflict (meeting_id) do nothing;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object('attached', v_inserted = 1);
end;
$$;

comment on function public.attach_nfc_meeting_location(uuid, double precision, double precision, double precision, timestamptz) is
  'Attaches a self-reported location to an nfc_card meeting the CALLER '
  'themselves tapped (§4.5, amended 2026-08-28). Display data only: it never '
  'decides whether a connection exists, cannot create or alter a meeting, '
  'connection, participant or session, and refuses any qr_gps meeting so a '
  'gate-verified position can never be overwritten by an unverified one. '
  'Every refusal returns the identical {attached: false} — no such meeting, '
  'not the caller''s, wrong method, already located, outside the window, a '
  'malformed or future-dated fix, rate-limited, or missing config.';

revoke all on function public.attach_nfc_meeting_location(uuid, double precision, double precision, double precision, timestamptz) from public, anon;
grant execute on function public.attach_nfc_meeting_location(uuid, double precision, double precision, double precision, timestamptz) to authenticated;
