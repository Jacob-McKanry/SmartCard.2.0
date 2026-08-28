-- =============================================================================
-- 20260828140000_fn_get_claimable_import_event_id.sql
--
-- WHAT THIS CHANGES
--   `create or replace`'s `public.get_claimable_import(text)` to add `event_id`
--   to its returned jsonb. No table changes, no grant changes, no behaviour
--   changes to any refusal, rate limit or gate — the only difference in the
--   response body is one new key, present exactly when `event_name` already
--   is.
--
-- WHY THIS EXISTS — A GAP FOUND BUILDING C4, NOT ANTICIPATED BUILDING C2
--   §4.2 step 5 of the 2026-08-22 attendee-import design is "land on the
--   event" once a claim succeeds. Building the claim screens (C4) surfaced
--   that nothing returns *which* event that is: this function names it
--   (`event_name`) but not its id, and `claim_event_import` (20260828130000)
--   answers only `{claimed: boolean}` by design (§3.6) and was never going to
--   carry it either. Neither omission was a decision at the time each was
--   built — C2 and C3 both predate there being a screen that needed to route
--   anywhere. Reusing 20260828130000's own header pattern: this is a gap in
--   an earlier migration's own scope, not a reason to change what either
--   function already does.
--
-- WHY THE FIX IS HERE, AND WHY IT DOES NOT ALSO TOUCH `claim_event_import`
--   The web app already calls `get_claimable_import` once, on page load,
--   before it ever shows the review screen — that is where `event_id` is
--   needed, to build the link the caller lands on after submitting the claim.
--   The claim submission itself does not need to RETURN it: the caller
--   already has it from the read that happened first. Adding it there too
--   would be a second copy of the same value for no caller that needs it, and
--   `claim_event_import`'s answer staying exactly `{claimed: boolean}` keeps
--   §3.6's argument for that shape intact — this migration touches zero lines
--   of that function.
--
-- WHY DISCLOSING `event_id` HERE IS NOT A WIDER GRANT THAN THIS FUNCTION
-- ALREADY MAKES
--   `event_name` is already returned at this same disclosure level (§11.1.4:
--   "shown whenever the token itself resolves to a live, unclaimed, unexpired
--   row, regardless of can_claim" — a caller holding the 244-bit token already
--   knows this much). An event's id is not a secret sitting behind some
--   narrower boundary than its title: `events` rows are read through
--   `can_see_event`-gated policies the same as ever, so handing back the id
--   changes what a caller can NAME, not what they can SEE. Nothing about this
--   column being present required constant-time care that adding a second
--   already-disclosed-scope column would upset.
-- =============================================================================

create or replace function public.get_claimable_import(p_lookup_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_per_user_limit integer;
  v_per_import_limit integer;
  v_row public.event_attendee_imports%rowtype;
  v_event_title text;
  v_host_first_name text;
  v_host_last_name text;
  v_host_found boolean;
  v_can_claim boolean;
begin
  if v_user is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select (value #>> '{}')::integer into v_per_user_limit
    from public.app_config where key = 'rate_limit_claim_lookup_per_user_hour';
  select (value #>> '{}')::integer into v_per_import_limit
    from public.app_config where key = 'rate_limit_claim_lookup_per_import_hour';

  if v_per_user_limit is null or v_per_import_limit is null then
    raise exception 'claim lookup configuration missing' using errcode = '55000';
  end if;

  if not public.rate_limit_consume(
       'claim_lookup', 'user', v_user::text, v_per_user_limit, 3600) then
    return jsonb_build_object('available', false);
  end if;

  select * into v_row
    from public.event_attendee_imports
   where lookup_token = p_lookup_token;

  if v_row.id is null then
    return jsonb_build_object('available', false);
  end if;

  if not public.rate_limit_consume(
       'claim_lookup', 'import', v_row.id::text, v_per_import_limit, 3600) then
    return jsonb_build_object('available', false);
  end if;

  if v_row.claimed_at is not null or v_row.expires_at <= now() then
    return jsonb_build_object('available', false);
  end if;

  select e.title, u.first_name, u.last_name, true
    into v_event_title, v_host_first_name, v_host_last_name, v_host_found
    from public.events e
    join public.users u on u.id = e.host_user_id
   where e.id = v_row.event_id;

  if not coalesce(v_host_found, false) then
    return jsonb_build_object('available', false);
  end if;

  v_can_claim := private.import_claim_authorized(v_row);

  return jsonb_build_object(
    'available', true,
    'event_id', v_row.event_id,
    'event_name', v_event_title,
    'host_first_name', v_host_first_name,
    'host_last_name', v_host_last_name,
    'can_claim', v_can_claim,
    'prefill', case when v_can_claim then jsonb_build_object(
      'first_name', v_row.first_name,
      'last_name', v_row.last_name,
      'phone_number', v_row.phone_number,
      'company_name', v_row.company_name,
      'company_role', v_row.company_role,
      'social_links', v_row.social_links
    ) else null end
  );
end;
$$;

comment on function public.get_claimable_import(text) is
  'The first read path into event_attendee_imports (§3.8 of the 2026-08-22 '
  'attendee-import design). Requires `authenticated` — see 20260828120000''s '
  'header for why that departs from §4.2''s literal step order. Always '
  'reveals event id, event name and host name once a token resolves to a '
  'live row (possession already discloses that much); reveals the personal '
  'prefill only when private.import_claim_authorized holds for the caller. '
  'Every refusal — no such token, expired, already claimed, rate-limited, or '
  'gate not satisfied for `can_claim` specifically — is indistinguishable '
  'from every other, per §3.6.';
