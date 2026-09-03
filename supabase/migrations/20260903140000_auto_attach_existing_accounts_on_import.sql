-- =============================================================================
-- 20260903140000_auto_attach_existing_accounts_on_import.sql
--
-- WHAT THIS CHANGES
--   Widens `public.import_event_attendees` (20260827130000): when an
--   imported row's email matches an EXISTING, ACTIVE SmartCard account, that
--   row is immediately claimed on the account's behalf — no click, no
--   emailed link, no email-verification check — and its PII is destroyed in
--   the same statement, exactly as a normal claim would. Adds
--   `matched_existing_accounts` to the summary jsonb the RPC returns.
--
-- WHY THIS EXISTS, AND WHY IT IS A DELIBERATE, FLAGGED DEVIATION
--   Owner decision, 2026-09-03 (chat), after being shown the tradeoff
--   explicitly and choosing it anyway. Every other "who attended" or "who's
--   on the roster" surface in this codebase requires the person's own
--   action — `2026-08-27-event-attendee-roster.md`'s own line is "nobody
--   appears without their own explicit choice (unanswered = hidden)", and
--   the ordinary claim flow (C2-C5 of the import design) exists specifically
--   because attendance was never meant to attach itself. This migration
--   narrows that principle for one specific case: an EXISTING account whose
--   email a host's own guest list already names. The honest statement of
--   the risk, given to the owner before this shipped: a host could import
--   any real member's email and have "you were on the guest list" appear
--   on that member's own private history with no confirmation from them at
--   all — the host does not need to be telling the truth for this to fire.
--
--   WHY THIS IS NARROWER THAN IT SOUNDS, AND WHY THAT MATTERS TO THE RISK.
--   The only two things reading a claimed-by-auto-match row are
--   `own_attended_events()` (private — a caller sees only their OWN claimed
--   rows, `20260828150000`) and the event page's own attendance note
--   (`AttendedNote`, rendered only to the viewer it is about). Neither
--   discloses anything to anyone else. The roster (the 2026-08-27 document)
--   has its own INDEPENDENT opt-in column, `roster_visibility`, which this
--   migration never touches and is not even built yet — so an auto-matched
--   row does not put anyone on any surface a third party can read. This is
--   what makes "fully automatic" defensible here in a way it would not be
--   for anything roster-shaped: the exposure this migration can cause is
--   confined to a person's own account.
--
--   WHY THE SCOPE STOPS AT THE ATTENDANCE FACT, AND NEVER TOUCHES A
--   PROFILE FIELD. The owner asked for attendees to "show up" automatically,
--   not for their profile to be silently rewritten from a host's guess.
--   Unlike the ordinary claim flow's `coalesce(existing, csv_value)`
--   fill-blanks behaviour, auto-match writes NOTHING to `users` — no phone
--   number, no company, no social link. It sets exactly
--   `claimed_by_user_id`/`claimed_at`, then destroys the row's PII the same
--   way every claim does. A host's guess about a real member's phone number
--   landing on that member's own profile without them ever having agreed to
--   it would be a materially different, and much harder to justify,
--   overreach than "you were recorded as attending."
--
--   WHY status = 'active' IS PART OF THE MATCH. A `deleted`/`suspended`
--   account should not silently regain a new attendance fact through a side
--   door while every ordinary write path treats that status as "this
--   account is not a normal write target" — matching the same status check
--   `is_verified_host` gating and other reads in this schema already apply.
--
--   WHAT THIS DOES NOT DO. It only runs at import time, on the rows in that
--   one call — it is not a standing sync that retroactively claims a
--   pending row the moment someone signs up days later. A host who wants
--   that has to re-run the import (harmless: the upsert is idempotent, and
--   an already-claimed row is untouched). It also never overrides the
--   ordinary claim flow — the copy-link screen, the emailed claim link (once
--   sent), and `get_claimable_import`/`claim_event_import` all still work
--   exactly as before for anyone whose row was NOT auto-matched.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   No RLS or grant change. `import_event_attendees` is still `authenticated`
--   -only, still requires a verified host of the specific event, still
--   consumes the same daily budget before doing any work. The new lookup
--   (`select id from public.users where email = ... and status = 'active'`)
--   runs inside this `security definer` function exactly like every other
--   internal read in it — never exposed as a separate callable check a host
--   could probe with an arbitrary address.
--
-- VERIFIED LIVE in a rolled-back transaction before applying: a row matching
--   an existing ACTIVE account is claimed immediately (all PII nulled,
--   `matched_existing_accounts` = 1) and appears in that account's own
--   `own_attended_events()` with no claim call ever made; a row matching a
--   DELETED account's email is left pending, unclaimed, exactly as before;
--   the matched account's `phone_number` (and by the same code path every
--   other profile column) is never written; an unrelated stranger row is
--   unaffected; `imported`/`skipped_no_email` counts are unchanged in shape
--   for rows this feature does not touch.
-- =============================================================================

create or replace function public.import_event_attendees(
  p_event_id uuid,
  p_rows jsonb,
  p_attested boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_max_rows integer;
  v_retention_days integer;
  v_per_host_limit integer;
  v_now timestamptz := now();
  v_expires timestamptz;
  v_row jsonb;
  v_email text;
  v_total integer := 0;
  v_imported integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_skipped_claimed integer := 0;
  v_matched_existing integer := 0;
  v_inserted boolean;
  v_row_id uuid;
  v_matched_user uuid;
begin
  if v_user is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.users u
    where u.id = v_user and u.status = 'active' and u.is_verified_host
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.host_user_id = v_user
      and e.status = 'scheduled'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_attested is not true then
    raise exception 'an attestation is required to import contacts'
      using errcode = '22023';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a json array' using errcode = '22023';
  end if;

  select (value #>> '{}')::integer into v_max_rows
    from public.app_config where key = 'event_import_max_rows';
  select (value #>> '{}')::integer into v_retention_days
    from public.app_config where key = 'event_import_unclaimed_retention_days';
  select (value #>> '{}')::integer into v_per_host_limit
    from public.app_config where key = 'rate_limit_event_import_per_host_day';

  if v_max_rows is null or v_retention_days is null or v_per_host_limit is null then
    raise exception 'import configuration missing' using errcode = '55000';
  end if;

  v_total := jsonb_array_length(p_rows);

  if v_total > v_max_rows then
    raise exception 'that file has % rows; the limit is %', v_total, v_max_rows
      using errcode = '22023';
  end if;

  if not public.rate_limit_consume(
       'event_import', 'user', v_user::text, v_per_host_limit, 86400) then
    raise exception 'too many imports today' using errcode = '53400';
  end if;

  v_expires := v_now + make_interval(days => v_retention_days);

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_email := btrim(coalesce(v_row ->> 'email', ''));

    if v_email = '' or position('@' in v_email) = 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_inserted := null;
    v_row_id := null;

    insert into public.event_attendee_imports (
      event_id, email, first_name, last_name, phone_number,
      company_name, company_role, social_links, lookup_token,
      imported_by_user_id, imported_at, attested_at, source, expires_at
    )
    values (
      p_event_id,
      v_email::extensions.citext,
      nullif(btrim(coalesce(v_row ->> 'first_name', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'last_name', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'phone_number', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'company_name', '')), ''),
      nullif(btrim(coalesce(v_row ->> 'company_role', '')), ''),
      case
        when jsonb_typeof(v_row -> 'social_links') = 'array'
          then v_row -> 'social_links'
        else '[]'::jsonb
      end,
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      v_user, v_now, v_now, 'csv', v_expires
    )
    on conflict (event_id, email) do update set
      first_name     = coalesce(excluded.first_name,     public.event_attendee_imports.first_name),
      last_name      = coalesce(excluded.last_name,      public.event_attendee_imports.last_name),
      phone_number   = coalesce(excluded.phone_number,   public.event_attendee_imports.phone_number),
      company_name   = coalesce(excluded.company_name,   public.event_attendee_imports.company_name),
      company_role   = coalesce(excluded.company_role,   public.event_attendee_imports.company_role),
      social_links   = case
                         when jsonb_array_length(excluded.social_links) > 0
                           then excluded.social_links
                         else public.event_attendee_imports.social_links
                       end,
      attested_at    = excluded.attested_at,
      expires_at     = excluded.expires_at
    where public.event_attendee_imports.claimed_by_user_id is null
    returning id, (xmax = 0) into v_row_id, v_inserted;

    if not found then
      v_skipped_claimed := v_skipped_claimed + 1;
      continue;
    end if;

    if v_inserted then
      v_imported := v_imported + 1;
    else
      v_updated := v_updated + 1;
    end if;

    -- Auto-attach an EXISTING, ACTIVE SmartCard account by email match —
    -- see this migration's own header for the reasoning, the flagged risk,
    -- and why the scope stops at the attendance fact.
    select id into v_matched_user
      from public.users
     where email = v_email::extensions.citext and status = 'active';

    if v_matched_user is not null then
      update public.event_attendee_imports
         set claimed_by_user_id = v_matched_user,
             claimed_at = v_now,
             email = null, first_name = null, last_name = null,
             phone_number = null, company_name = null, company_role = null,
             social_links = '[]'::jsonb, lookup_token = null,
             emailed_at = null, email_error = null, email_send_claimed_at = null
       where id = v_row_id and claimed_by_user_id is null;

      if found then
        v_matched_existing := v_matched_existing + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'imported', v_imported,
    'updated', v_updated,
    'skipped_no_email', v_skipped,
    'skipped_already_claimed', v_skipped_claimed,
    'matched_existing_accounts', v_matched_existing
  );
end;
$$;

comment on function public.import_event_attendees(uuid, jsonb, boolean) is
  'Writes guest-list rows for one event. Requires an ACTIVE VERIFIED host who '
  'hosts that specific (non-cancelled) event, and an explicit attestation. '
  'Upserts on (event_id, email) so a re-upload corrects rather than '
  'duplicates, and never touches a row somebody has already claimed. A row '
  'matching an existing ACTIVE account is auto-claimed immediately — '
  'attendance fact only, no profile field written — see 20260903140000''s '
  'header for the reasoning and the risk it flags. Returns counts only, '
  'including matched_existing_accounts. The approved/declined filter is '
  'applied by the CSV parser before rows reach here — see this migration''s '
  'header for why.';
