-- =============================================================================
-- 20260828130000_fn_claim_event_import.sql
--
-- WHAT THIS CHANGES
--   Adds `public.claim_event_import(text, jsonb)` — the write that turns an
--   import row into a claimed profile and, in the same statement, destroys the
--   row's PII per §2.2. Adds `private.import_claim_authorized(row)`, a shared
--   gate extracted from `get_claimable_import` (20260828120000) so the
--   authorization formula exists in exactly one place rather than two that can
--   drift — `get_claimable_import` is `create or replace`'d here to call it
--   instead of computing the same three lines inline. Adds two `app_config`
--   rate-limit rows. Drops `NOT NULL` from `event_attendee_imports.email` and
--   `event_attendee_imports.lookup_token` (see below) — the only existing-table
--   changes this migration makes.
--
-- ===========================================================================
-- WHY `email` AND `lookup_token` LOSE THEIR `NOT NULL`, FOUND BY VERIFICATION
-- RATHER THAN ASSUMED — TWICE, IN THE SAME RUN
-- ===========================================================================
--   §2.2 says the claim nulls out `email` and `lookup_token` along with the
--   rest of the PII. The original table (20260827130000) made both `not null`
--   — correct for that migration's own scope, which never wrote a claim, but
--   wrong for this one: a rolled-back verification run of the exact UPDATE
--   below failed on `email` first (`23502 null value in column "email"
--   violates not-null constraint`), and — after fixing that one column and
--   re-running — failed the identical way on `lookup_token` immediately after.
--   Neither is a design conflict to resolve by choosing a different
--   destruction shape (a sentinel value, say): §2.2's own text is unambiguous
--   that both columns are nulled. Both are gaps in the first migration, which
--   had no reason yet to anticipate a row's second life stage as a destroyed
--   one — and the same gap, once found once, was worth checking for
--   everywhere rather than patched one column at a time as each one broke.
--
--   Dropping `NOT NULL` costs nothing against either column's `unique`
--   constraint (`unique (event_id, email)`, and `lookup_token`'s own bare
--   `unique`): Postgres treats every `NULL` as distinct from every other
--   `NULL`, so any number of claimed (and therefore nulled) rows can coexist
--   without conflict. Both constraints keep doing their real job — an event
--   cannot hold two live rows for one address, and a token cannot name two
--   live rows — and simply stop applying to rows that no longer have a value
--   at all.
--
-- WHY THIS EXISTS
--   §2.2/§3.8. `get_claimable_import` (C2) can tell a caller whether they may
--   claim a row and what it contains; nothing yet lets them actually do it.
--   This is that write, and per §2.2 it is also the LAST time this table ever
--   holds this person's contact details — the whole point of the feature's
--   data-minimisation story is that the destruction happens in the same
--   transaction as the claim, never as a follow-up job that could fail to run.
--
-- ===========================================================================
-- WHY THE GATE IS A SHARED FUNCTION NOW, NOT A SECOND COPY
-- ===========================================================================
--   `get_claimable_import` computes `can_claim` as three lines: does the live
--   `auth.email()` match the row, and (is it asserted verified OR does the
--   caller's account predate the import). This function needs the EXACT SAME
--   question, because it is the one place that actually matters — a caller who
--   never called `get_claimable_import` first, or who calls this with a
--   different session than the one that checked, still has to be re-derived
--   from scratch. Writing the formula a second time here would be the drift
--   this repo's own `private.can_see_event()` / `private.is_event_host()`
--   precedent exists to prevent — one authorization question, one function,
--   called from everywhere that needs the answer. `private.current_user_id()`
--   already sets this precedent for "who is calling"; this is the same move
--   for "may they claim this specific row".
--
-- ===========================================================================
-- WHY THE CLAIM AND THE DESTRUCTION ARE ONE UPDATE STATEMENT
-- ===========================================================================
--   Two things this single UPDATE buys, and neither survives splitting it:
--
--   1. THE RACE. `claimed_by_user_id is null` in the WHERE clause is what
--      makes concurrent claims safe, the same way `claim_unassigned_card`'s
--      `status = 'unassigned'` does: two calls for the same row — realistically
--      the same person, two tabs, since `users.email` is unique so only one
--      account can ever satisfy the email-match half of the gate at a time —
--      produce one UPDATE that matches and one that matches nothing, decided
--      by the database rather than by whichever request read first.
--   2. THE DATA-MINIMISATION GUARANTEE. §2.2's promise — "a breach of this
--      table exposes only unclaimed rows" — is only true if there is no
--      instant where a row is claimed but the PII has not yet been destroyed.
--      A second statement, even in the same function, is a second statement
--      that could be the one that fails: a timeout, a lock wait, a crashed
--      connection between the two would leave a row silently claimed-but-
--      not-destroyed forever, and nothing would notice. One UPDATE cannot be
--      half-applied.
--
--   The destroyed columns match §2.2 exactly: `email`, `first_name`,
--   `last_name`, `phone_number`, `company_name`, `company_role`,
--   `social_links` (to `'[]'::jsonb`, since the column is `not null`), and
--   `lookup_token`. What survives is `(event_id, claimed_by_user_id,
--   claimed_at)` — the attendance fact, about a consenting user, which is what
--   `own_attended_events()` (not yet built) will read.
--
-- ===========================================================================
-- WHY AN APPROVED FIELD FILLS A BLANK RATHER THAN OVERWRITING ONE
-- ===========================================================================
--   `p_approved_fields` says which of the CSV's fields the caller chose to
--   keep — §4.2 step 4, "every field... individually keepable or discardable".
--   What "keep" means for someone who ALREADY has a value there is not stated
--   in the design in so many words, and it matters most for exactly the
--   accounts §3.2.1 exists to cover: the grandfather clause admits accounts
--   that predate the import, and a pre-existing account is the one case where
--   real, deliberately-typed profile data can already be sitting in that
--   column. Every write below is `coalesce(existing, csv_value)` — the CSV
--   fills a blank, it never replaces something the person already has. A
--   host's guest-list guess must never silently clobber a person's own words
--   about themselves; "prefill" is the word the whole design uses for this
--   data, and a prefill that overwrites is not a prefill.
--
--   Social links follow the same rule at row granularity: a platform the
--   caller already has any link for is left alone, and only a platform they
--   do not yet have gets a new row from the import.
--
-- ===========================================================================
-- WHY THIS ALSO GETS ITS OWN RATE LIMIT, SEPARATE FROM THE LOOKUP'S
-- ===========================================================================
--   Granted to `authenticated`, reachable directly over PostgREST like every
--   sibling RPC. A lookup and a write are different costs and different risks,
--   so they get their own budgets rather than sharing `get_claimable_import`'s
--   — consumed BEFORE the row is resolved, same posture as
--   `claim_unassigned_card`, so a refused or rate-limited attempt still spends
--   its budget and probing stays non-free.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- event_attendee_imports.email / lookup_token: drop NOT NULL — see the header
-- ---------------------------------------------------------------------------
alter table public.event_attendee_imports alter column email drop not null;
alter table public.event_attendee_imports alter column lookup_token drop not null;

-- ---------------------------------------------------------------------------
-- private.import_claim_authorized — the gate, extracted so it exists once
-- ---------------------------------------------------------------------------
create or replace function private.import_claim_authorized(p_row public.event_attendee_imports)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_email_matches boolean;
  v_caller_created_at timestamptz;
  v_grandfathered boolean;
begin
  if v_user is null then
    return false;
  end if;

  -- Email match is the lookup key and never the sole authorization on its own
  -- (§3.2) — it must hold together with EITHER a live verification claim or an
  -- account old enough to predate this import (§3.2.1). `coalesce(..., false)`
  -- rather than plpgsql's tri-state boolean: a null `auth.email()` must
  -- resolve to a hard `false`, not a `null` that then makes the final `and`
  -- evaluate to `null` instead of `false`.
  v_email_matches := coalesce(nullif(auth.email(), '')::extensions.citext = p_row.email, false);

  select created_at into v_caller_created_at from public.users where id = v_user;
  v_grandfathered := coalesce(v_caller_created_at < p_row.imported_at, false);

  return v_email_matches and (private.current_email_verified() or v_grandfathered);
end;
$$;

comment on function private.import_claim_authorized(public.event_attendee_imports) is
  'The §3.2/§3.2.1 claim gate, extracted from get_claimable_import so both it '
  'and claim_event_import ask the identical question rather than each keeping '
  'their own copy that could drift. True only when the caller''s live email '
  'claim matches the row AND (that email is asserted verified, or the '
  'caller''s account predates the import).';

revoke all on function private.import_claim_authorized(public.event_attendee_imports) from public, anon, authenticated;
grant execute on function private.import_claim_authorized(public.event_attendee_imports) to authenticated;

-- ---------------------------------------------------------------------------
-- get_claimable_import: re-pointed at the shared gate, behaviour unchanged
-- ---------------------------------------------------------------------------
-- Every line that changed is the three the gate used to compute inline; the
-- rate limits, the refusal shapes and the teaser/prefill split are untouched.
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
  'reveals event name and host name once a token resolves to a live row '
  '(possession already discloses that much); reveals the personal prefill '
  'only when private.import_claim_authorized holds for the caller. Every '
  'refusal — no such token, expired, already claimed, rate-limited, or gate '
  'not satisfied for `can_claim` specifically — is indistinguishable from '
  'every other, per §3.6.';

-- ---------------------------------------------------------------------------
-- Rate limits for the claim itself
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value, description) values
  ('rate_limit_event_claim_per_user_hour', '20'::jsonb,
   'Maximum claim_event_import calls ONE signed-in account may make per hour. A real claim happens once per row and cannot repeat on the same row after it succeeds, so this mostly bounds repeated FAILED attempts — trying to claim a row that is not theirs, or retrying past a config outage. Generous enough to cover someone who attended several hosts'' events and claims each in one sitting.'),

  ('rate_limit_event_claim_per_import_hour', '10'::jsonb,
   'Maximum claim_event_import calls against ONE import row per hour, regardless of caller. Bounds repeated attempts to claim someone else''s row, or a client bug retrying in a loop, independent of any one account''s own budget.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- public.claim_event_import
-- ---------------------------------------------------------------------------
create or replace function public.claim_event_import(p_lookup_token text, p_approved_fields jsonb)
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
  v_updated integer;
  v_keep_first_name boolean;
  v_keep_last_name boolean;
  v_keep_phone_number boolean;
  v_keep_company_name boolean;
  v_keep_company_role boolean;
  v_keep_social_links boolean;
  v_link jsonb;
begin
  if v_user is null then
    return jsonb_build_object('claimed', false);
  end if;

  select (value #>> '{}')::integer into v_per_user_limit
    from public.app_config where key = 'rate_limit_event_claim_per_user_hour';
  select (value #>> '{}')::integer into v_per_import_limit
    from public.app_config where key = 'rate_limit_event_claim_per_import_hour';

  -- Fail closed (CLAUDE.md): a missing config row refuses rather than running
  -- with no limit.
  if v_per_user_limit is null or v_per_import_limit is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Per-caller budget FIRST, before the row is even resolved — cheapest check,
  -- needs no lookup.
  if not public.rate_limit_consume(
       'event_claim', 'user', v_user::text, v_per_user_limit, 3600) then
    return jsonb_build_object('claimed', false);
  end if;

  select * into v_row
    from public.event_attendee_imports
   where lookup_token = p_lookup_token;

  -- No such token. Same shape as every other refusal below — this function
  -- never says which reason applied (§3.6).
  if v_row.id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Per-row budget, once the token resolves to one. Keyed on the row's `id`
  -- rather than the raw token, matching claim_unassigned_card's choice for
  -- `card_code` and get_claimable_import's for the same reason.
  if not public.rate_limit_consume(
       'event_claim', 'import', v_row.id::text, v_per_import_limit, 3600) then
    return jsonb_build_object('claimed', false);
  end if;

  if v_row.claimed_at is not null or v_row.expires_at <= now() then
    return jsonb_build_object('claimed', false);
  end if;

  if not private.import_claim_authorized(v_row) then
    return jsonb_build_object('claimed', false);
  end if;

  -- Which fields the caller approved. Absent, malformed, or anything but the
  -- literal JSON `true` reads as "discard" — a checkbox's own default, and the
  -- fail-closed direction: get this wrong and the failure is a field the
  -- person did NOT ask for silently not being copied, never the reverse.
  v_keep_first_name   := coalesce((p_approved_fields ->> 'first_name')::boolean, false);
  v_keep_last_name    := coalesce((p_approved_fields ->> 'last_name')::boolean, false);
  v_keep_phone_number := coalesce((p_approved_fields ->> 'phone_number')::boolean, false);
  v_keep_company_name := coalesce((p_approved_fields ->> 'company_name')::boolean, false);
  v_keep_company_role := coalesce((p_approved_fields ->> 'company_role')::boolean, false);
  v_keep_social_links := coalesce((p_approved_fields ->> 'social_links')::boolean, false);

  -- THE ATOMIC CLAIM AND THE §2.2 DESTRUCTION, ONE STATEMENT. See the header
  -- for why this cannot be two. `claimed_by_user_id is null` decides the race;
  -- `expires_at > now()` is the same expiry check re-asserted at the instant
  -- of writing rather than trusted from the read above.
  update public.event_attendee_imports
     set claimed_by_user_id = v_user,
         claimed_at = now(),
         email = null,
         first_name = null,
         last_name = null,
         phone_number = null,
         company_name = null,
         company_role = null,
         social_links = '[]'::jsonb,
         lookup_token = null
   where id = v_row.id
     and claimed_by_user_id is null
     and expires_at > now();

  get diagnostics v_updated = row_count;

  -- Lost the race, or the row changed under us between the read above and
  -- this statement. Same refusal shape as every other reason.
  if v_updated <> 1 then
    return jsonb_build_object('claimed', false);
  end if;

  -- Fill blanks only, never overwrite — see the header. `v_row` is the
  -- PL/pgSQL variable's own snapshot from the SELECT above, so it still holds
  -- the pre-destruction values even though the table row was just nulled out.
  update public.users
     set first_name   = case when v_keep_first_name   then coalesce(first_name,   v_row.first_name)   else first_name   end,
         last_name    = case when v_keep_last_name    then coalesce(last_name,    v_row.last_name)    else last_name    end,
         phone_number = case when v_keep_phone_number then coalesce(phone_number, v_row.phone_number) else phone_number end,
         company_name = case when v_keep_company_name then coalesce(company_name, v_row.company_name) else company_name end,
         company_role = case when v_keep_company_role then coalesce(company_role, v_row.company_role) else company_role end
   where id = v_user;

  if v_keep_social_links then
    for v_link in select * from jsonb_array_elements(coalesce(v_row.social_links, '[]'::jsonb))
    loop
      -- Skip a platform the caller already has any link for — the same
      -- fill-blanks-only rule applied at row granularity, so a manually-added
      -- link is never displaced by the CSV's guess.
      insert into public.social_links (user_id, platform, url)
      select v_user, v_link ->> 'platform', v_link ->> 'url'
      where v_link ->> 'platform' is not null
        and v_link ->> 'url' is not null
        and not exists (
          select 1 from public.social_links
           where user_id = v_user and platform = v_link ->> 'platform'
        );
    end loop;
  end if;

  return jsonb_build_object('claimed', true);
end;
$$;

comment on function public.claim_event_import(text, jsonb) is
  'Claims an import row (§2.2/§3.8 of the 2026-08-22 attendee-import design): '
  'copies the fields named true in p_approved_fields into the caller''s own '
  'profile — filling blanks only, never overwriting — then destroys the '
  'row''s PII in the same statement as recording the claim. Re-derives the '
  'full §3.2/§3.2.1 gate itself via private.import_claim_authorized; does not '
  'trust that the caller ever called get_claimable_import first. Returns '
  '{claimed: boolean} and nothing else — no reason, matching CardClaimResult '
  '(card-claim-service.ts) for the same §3.6 reason: telling a caller WHICH '
  'check failed would be the oracle this design refuses to be.';

revoke all on function public.claim_event_import(text, jsonb) from public, anon;
grant execute on function public.claim_event_import(text, jsonb) to authenticated;
