-- =============================================================================
-- 20260926130000_fn_create_manual_connection.sql
--
-- WHAT THIS CHANGES
--   Part 2 of the "unverified connections" amendment
--   (docs/architecture/2026-09-26-unverified-connections.md). Creates
--   `public.create_manual_connection(...)`, a new, second atomic writer of
--   `connections`/`meetings`/`meeting_participants`/`meeting_locations` —
--   deliberately NOT a change to `create_verified_connection`
--   (20260813210300), which stays exactly as it was and keeps serving the
--   qr_gps/nfc_card paths unchanged.
--
-- READ THIS BEFORE TOUCHING §4.7 THREAT 4'S "NEVER A SECOND WRITE PATH" RULE
--   `create_verified_connection`'s own header calls a second writer of
--   `connections` "the second path §4.7 threat 4 forbids", and
--   `no-second-write-path.test.ts` exists specifically to catch one being
--   added by accident. This migration adds exactly that second path,
--   DELIBERATELY, because the owner explicitly asked for a way to create a
--   connection with no verification at all (four rounds of confirmed
--   multiple-choice answers, recorded in the architecture doc). It is not a
--   bug this migration failed to prevent — it is the amendment. What §4.7
--   threat 4 protected against was an ACCIDENTAL second path (a handler
--   assembling `{ok:true}` itself, bypassing the branded `VerifiedOutcome`
--   type). This function is not that: it never claims to be verified, never
--   touches the `VerifiedOutcome`/`sealVerified` machinery in
--   `packages/core` at all, and is reachable only through its own,
--   separately-named, separately-documented server action — nothing here
--   pretends an unverified connection is a verified one.
--
-- WHAT THIS FUNCTION DOES, IN ORDER
--   1. Refuses if the creator is not a real, active account (defence in
--      depth — the caller is expected to have already derived this from an
--      authenticated session, exactly as `create_verified_connection`'s own
--      header describes for its two parties).
--   2. Refuses on an invalid method, or if the caller supplied neither (nor
--      both) of `p_other_user_id` / `p_other_contact`.
--   3. Resolves the other party:
--      - If `p_other_user_id` was given directly, re-verifies it names a
--        real row (any status — see the note on matched-but-unavailable
--        accounts below).
--      - Otherwise, looks up `p_other_contact`'s email, then phone, against
--        EVERY existing `users` row (not only `'active'` ones — see below).
--        A match makes that the other party, full stop — this is the
--        "already has an account" path, and per the owner's explicit
--        choice it grants full, instant, mutual profile access with no
--        action on the matched person's part.
--      - No match creates a new `status = 'placeholder'` row from the
--        contact fields supplied.
--   4. Refuses self-connect and existing blocks, exactly like
--      `create_verified_connection`.
--   5. Writes a born-`consumed` `connection_sessions` row (mirrors the
--      existing `nfc_card` technique — see that function's header — so
--      `meetings.verification_session_id`'s NOT NULL/UNIQUE invariant holds
--      mechanically even though nothing was actually redeemed), then
--      `meetings`, `meeting_participants`, an optional `meeting_locations`
--      row (only if a fix was actually captured — the "absence of row
--      = absence of location" rule, unchanged), and finally `connections`
--      itself, reusing the exact ordered-pair / reconnect logic
--      `create_verified_connection` already has.
--
-- WHY A MATCHED BUT SUSPENDED/DELETED ACCOUNT IS A REFUSAL, NOT A NEW
-- PLACEHOLDER. `users.email` is `NOT NULL UNIQUE` across every status. If the
-- email/phone search found a suspended or deleted account, inserting a
-- second row with the same email would hit that unique constraint and
-- throw — so this function checks explicitly and refuses cleanly
-- (`other_party_unavailable`) rather than letting a constraint violation
-- surface as an unhandled error.
--
-- WHY A MATCHED EXISTING PLACEHOLDER IS REUSED, NOT DUPLICATED. If two
-- different people scan or type in the same non-user's card, the second one
-- should land on the SAME placeholder row the first one created — again
-- because `email` is unique, a second insert would fail outright, and
-- reusing the row is also the more honest outcome (one placeholder per real
-- person, not one per person who added them).
--
-- JUDGMENT CALL, RECORDED — PHONE MATCHING PICKS ONE ROW AMONG POSSIBLE
-- SEVERAL. Unlike `email`, `users.phone_number` has no uniqueness
-- constraint, so a phone-only match can have more than one candidate. This
-- function orders candidates active-status-first, then most-recently
-- created, and takes one. The owner's own choice ("match by email or
-- phone") accepted this fuzziness; it is called out here rather than
-- silently resolved so a future reader does not mistake it for a strong
-- guarantee the way an email match actually is.
--
-- JUDGMENT CALL — WHAT A PLACEHOLDER'S `email` IS WHEN NOTHING WAS SCANNED
-- WITH AN EMAIL ON IT. `users.email` is `NOT NULL UNIQUE` (20260809210100);
-- loosening that for this one feature would touch every other reader of the
-- column across the app. Rather than do that, a placeholder created from a
-- contact with no email gets a synthesized, obviously-non-deliverable
-- address (`placeholder+<uuid>@placeholder.smartcard.invalid`) purely to
-- satisfy the constraint — never shown to anyone as if it were real (the UI
-- built in the next phase must render placeholder contacts by name/phone,
-- not by echoing this address back).
--
-- ACCESS GRANTED / FORBIDDEN
--   EXECUTE revoked from PUBLIC, `anon` and `authenticated`; granted to
--   `service_role` alone — identical posture to `create_verified_connection`,
--   for the identical reason stated in that function's own header: as
--   `security invoker`, a future mis-grant to `authenticated` still hits the
--   absent INSERT policies on `connections`/`meetings`/`users` rather than
--   bypassing them.
--   Grants (once wired to a server action in a later phase): any signed-in
--   user may create a full, live, mutual connections-graph edge to ANY other
--   person — by naming an existing real account's email/phone (instant
--   mutual profile access, no action or notice on that person's part) or by
--   supplying free-typed contact details for someone with no account (a
--   placeholder row is created for them immediately). No rate limit, no
--   confirmation step, no notification — all per the owner's explicit,
--   repeated choice, recorded in full in the architecture doc linked above.
--
-- VERIFIED LIVE in a rolled-back transaction before applying: a call with a
--   brand-new email creates exactly one placeholder row and one active
--   connection; a call whose email matches an existing active user connects
--   to that real row with no new row created, and that user's profile
--   becomes readable by the caller through the ordinary `are_connected`
--   policy branch with zero policy changes; a call whose email matches a
--   `'deleted'` account refuses with `other_party_unavailable` rather than
--   throwing; a second call naming the same not-yet-claimed email reuses the
--   same placeholder row rather than duplicating or erroring; self-connect
--   and block checks refuse exactly as `create_verified_connection`'s do;
--   `origin_meeting_id`/`verification_session_id` invariants hold for every
--   new method value.
-- =============================================================================

create or replace function public.create_manual_connection(
  p_creator_user_id uuid,
  p_method text,
  p_other_user_id uuid,
  p_other_contact jsonb,
  p_occurred_at timestamptz,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_other_user_id uuid;
  v_matched_id uuid;
  v_matched_status text;
  v_email extensions.citext;
  v_phone text;
  v_user_a uuid;
  v_user_b uuid;
  v_meeting_id uuid;
  v_session_id uuid;
  v_connection_id uuid;
  v_existing_id uuid;
  v_existing_status text;
  v_reconnected boolean := false;
begin
  if p_creator_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_creator');
  end if;

  if not exists (
    select 1 from public.users where id = p_creator_user_id and status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'creator_not_active');
  end if;

  if p_method is null or p_method not in (
    'card_scan_ocr', 'badge_qr', 'badge_nfc', 'manual_entry'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_method');
  end if;

  -- Exactly one of the two "who is the other party" inputs must be given.
  if (p_other_user_id is null) = (p_other_contact is null) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_other_party');
  end if;

  -- ---------------------------------------------------------------------
  -- Resolve the other party.
  -- ---------------------------------------------------------------------
  if p_other_user_id is not null then
    select id, status into v_matched_id, v_matched_status
    from public.users where id = p_other_user_id;

    if v_matched_id is null then
      return jsonb_build_object('ok', false, 'reason', 'other_party_not_found');
    end if;
    if v_matched_status in ('suspended', 'deleted') then
      return jsonb_build_object('ok', false, 'reason', 'other_party_unavailable');
    end if;
    v_other_user_id := v_matched_id;
  else
    v_email := nullif(btrim(coalesce(p_other_contact ->> 'email', '')), '')::extensions.citext;
    v_phone := nullif(btrim(coalesce(p_other_contact ->> 'phone_number', '')), '');

    if v_email is not null then
      select id, status into v_matched_id, v_matched_status
      from public.users where email = v_email;
    end if;

    if v_matched_id is null and v_phone is not null then
      -- See the header's judgment call: phone is not unique, so this picks
      -- one candidate among possibly several.
      select id, status into v_matched_id, v_matched_status
      from public.users
      where phone_number = v_phone
      order by (status = 'active') desc, created_at desc
      limit 1;
    end if;

    if v_matched_id is not null then
      if v_matched_status in ('suspended', 'deleted') then
        return jsonb_build_object('ok', false, 'reason', 'other_party_unavailable');
      end if;
      -- Either a real active account (instant mutual access) or an existing
      -- placeholder from an earlier scan/add — reused, not duplicated.
      v_other_user_id := v_matched_id;
    else
      insert into public.users (
        kinde_user_id, email, first_name, last_name, phone_number,
        company_name, company_role, status, placeholder_source
      ) values (
        null,
        coalesce(
          v_email,
          ('placeholder+' || gen_random_uuid()::text || '@placeholder.smartcard.invalid')
            ::extensions.citext
        ),
        nullif(btrim(coalesce(p_other_contact ->> 'first_name', '')), ''),
        nullif(btrim(coalesce(p_other_contact ->> 'last_name', '')), ''),
        v_phone,
        nullif(btrim(coalesce(p_other_contact ->> 'company_name', '')), ''),
        nullif(btrim(coalesce(p_other_contact ->> 'company_role', '')), ''),
        'placeholder',
        p_method
      )
      returning id into v_other_user_id;
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- Self-connect and blocks, exactly as create_verified_connection checks.
  -- ---------------------------------------------------------------------
  if v_other_user_id = p_creator_user_id then
    return jsonb_build_object('ok', false, 'reason', 'self_connect');
  end if;

  if exists (
    select 1 from public.blocks b
    where (b.blocker_user_id = p_creator_user_id and b.blocked_user_id = v_other_user_id)
       or (b.blocker_user_id = v_other_user_id and b.blocked_user_id = p_creator_user_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;

  v_user_a := least(p_creator_user_id, v_other_user_id);
  v_user_b := greatest(p_creator_user_id, v_other_user_id);

  select c.id, c.status
    into v_existing_id, v_existing_status
  from public.connections c
  where c.user_a_id = v_user_a and c.user_b_id = v_user_b
  for update;

  if v_existing_id is not null and v_existing_status = 'active' then
    return jsonb_build_object('ok', false, 'reason', 'already_connected');
  end if;

  -- ---------------------------------------------------------------------
  -- The write. No session to redeem, no gate to evaluate — see the header.
  -- ---------------------------------------------------------------------
  begin
    insert into public.connection_sessions
      (method, presenter_user_id, status, expires_at, consumed_at, consumed_by_user_id)
    values
      (p_method, p_creator_user_id, 'consumed', v_now, v_now, v_other_user_id)
    returning id into v_session_id;

    insert into public.meetings (occurred_at, verification_method, verification_session_id)
    values (coalesce(p_occurred_at, v_now), p_method, v_session_id)
    returning id into v_meeting_id;

    insert into public.meeting_participants (meeting_id, user_id)
    values (v_meeting_id, p_creator_user_id), (v_meeting_id, v_other_user_id);

    if p_latitude is not null and p_longitude is not null and p_accuracy_m is not null then
      insert into public.meeting_locations (meeting_id, latitude, longitude, accuracy_m)
      values (v_meeting_id, p_latitude, p_longitude, p_accuracy_m);
    end if;

    if v_existing_id is null then
      insert into public.connections (user_a_id, user_b_id, origin_meeting_id)
      values (v_user_a, v_user_b, v_meeting_id)
      returning id into v_connection_id;
    else
      -- Same "reconnect" reasoning as create_verified_connection: the pair
      -- connected once, removed it, and this add is fresh evidence (of a
      -- kind) for a new edge, so the row is reactivated rather than refused.
      update public.connections c
         set status = 'active',
             origin_meeting_id = v_meeting_id,
             created_at = v_now
       where c.id = v_existing_id;
      v_connection_id := v_existing_id;
      v_reconnected := true;
    end if;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'reason', 'already_connected');
  end;

  return jsonb_build_object(
    'ok', true,
    'connection_id', v_connection_id,
    'meeting_id', v_meeting_id,
    'other_user_id', v_other_user_id,
    'reconnected', v_reconnected
  );
end;
$$;

comment on function public.create_manual_connection(
  uuid, text, uuid, jsonb, timestamptz, double precision, double precision, double precision
) is
  'The unverified counterpart to create_verified_connection (2026-09-26, '
  'docs/architecture/2026-09-26-unverified-connections.md): writes a full '
  'connections-graph edge from a card/badge scan or manual entry, with no '
  'proximity or identity verification of any kind. Resolves the other party '
  'by id, or by email/phone match against existing users (instant mutual '
  'access if found), or creates a status=''placeholder'' row if not. '
  'service_role only; security INVOKER for the same reason '
  'create_verified_connection is.';

revoke all on function public.create_manual_connection(
  uuid, text, uuid, jsonb, timestamptz, double precision, double precision, double precision
) from public, anon, authenticated;

grant execute on function public.create_manual_connection(
  uuid, text, uuid, jsonb, timestamptz, double precision, double precision, double precision
) to service_role;
