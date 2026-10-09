-- =============================================================================
-- 20261009120000_users_eligibility_age_and_terms.sql
--
-- WHAT THIS CHANGES
--   Phase 2 of `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`
--   ("eligibility + safety foundations"), part 1 of 5: the 18+/terms gate's
--   backend (owner decision 11 — "the 18+/terms gate applies app-wide").
--     1. Three columns on `public.users`: `date_of_birth`, `terms_accepted_at`,
--        `terms_version`. All three are OUTSIDE both column-level grants to
--        `authenticated` (SELECT, 20260814230000; UPDATE, 20260809211100) —
--        no client can read or write any of them, on any row, including its
--        own.
--     2. One `app_config` row, `terms_current_version` (a JSON string, `"1"`).
--        Bumping it is how re-acceptance is forced for everyone.
--     3. `public.age_gate_failures` — one row per account that failed the age
--        check. Service-role only (forced RLS, zero policies, zero grants).
--     4. `private.age_in_years(date)` — the one place age is computed.
--     5. `public.accept_terms_and_confirm_age(date, text)` and
--        `public.my_eligibility()` — the only two ways anything outside the
--        database learns anything about these columns, and neither ever
--        returns a raw date of birth.
--
--   NOTHING IN THE LIVE APP CALLS EITHER RPC YET. Per the owner's explicit
--   instruction (recorded in the amendment's §9), the gate screen is built
--   only under the admin-gated, unlinked `/MapTest` route. No layout redirects
--   anybody through it today. So applying this migration changes nothing any
--   existing member experiences: every account simply reads
--   `needs_age_gate: true` from an RPC nothing calls.
--
-- WHY THE DATE OF BIRTH IS UNREADABLE EVEN TO ITS OWNER
--   A date of birth is the most re-identifying field this table has ever held
--   (it is one of the three fields — with postcode and sex — that famously
--   identify most people uniquely), and nothing in the product needs it as a
--   date: the map, the gate and every later check only need "is this person
--   18 or over", and at most "how old are they". So the date goes in, and
--   only a computed answer ever comes out. Leaving it out of the column
--   grants (rather than relying on every future query to omit it) means a
--   careless `select *` through an RLS-bound client, today or from a future
--   mobile client, fails with 42501 instead of disclosing it — the same
--   reasoning 20260814230000 applied to `is_admin` and `kinde_user_id`, and
--   the exact posture 20260827120000 gave `is_verified_host`.
--
--   The same is true of `terms_accepted_at` / `terms_version`: whether someone
--   accepted the terms is a fact about their compliance state that their
--   connections and co-attendees (who CAN read their row through the SELECT
--   policy) have no business seeing. `my_eligibility()` tells the caller about
--   themself; nobody else learns anything.
--
-- WHY AGE IS COMPUTED THE WAY IT IS (private.age_in_years)
--   * Calendar arithmetic, not year subtraction. `extract(year from age(a, b))`
--     counts completed years exactly, so someone born 2008-10-10 is 17 on
--     2026-10-09 and 18 on 2026-10-10. A naive `2026 - 2008 = 18` would admit
--     them a day (or up to a year) early.
--   * Leap-day birthdays reach 18 on 1 March in a non-leap year, not
--     28 February — `age()` borrows a month rather than clamping the day.
--     That is the later (stricter) of the two common legal readings, which is
--     the right direction to be wrong in for an age gate.
--   * "Today" is the calendar date at UTC-12, the last place on Earth where it
--     is still yesterday. A date of birth has no timezone, but "today" does:
--     at 20:00 UTC someone born tomorrow-in-UTC is already 18 in Kiribati and
--     still 17 in London. Using the westernmost date means a person is
--     admitted only once they are 18 everywhere, so the gate can be late by at
--     most one day and is never early. It is written as
--     `(now() at time zone 'UTC') - interval '12 hours'` rather than a named
--     `Etc/GMT+12` zone because the POSIX sign convention on those names is
--     inverted and easy to get backwards; the arithmetic cannot be misread.
--     It also does not depend on the session's `TimeZone` setting.
--
-- WHAT accept_terms_and_confirm_age DOES, IN ORDER, AND WHY THAT ORDER
--   1. Caller from the JWT (`private.current_user_id()`), never a parameter,
--      and the caller's own row locked `for update` so a double-submit
--      serialises rather than racing — the same compare-under-lock pattern
--      `soft_delete_own_account` uses.
--   2. Refuses a non-`active` caller. Unreachable today (a suspended, deleted
--      or placeholder account cannot get a token) and refused anyway.
--   3. Reads `terms_current_version`. Missing or blank -> refuses
--      (`unavailable`). Fails closed: there is no default version.
--   4. THE FINAL BLOCK. If this account already has an `age_gate_failures`
--      row, it is refused as `underage` again, whatever date is submitted
--      now. This is the phase brief's recommended default — "a final block,
--      logged, no retry" — enforced HERE rather than only by the UI not
--      offering a retry, because a UI-only block is defeated by reloading the
--      page and typing an earlier year. The repeat attempt is NOT logged
--      again, which bounds the log at one row per account (see 3 below).
--   5. Date of birth is WRITE-ONCE. If one is already on file (a returning
--      member re-accepting a bumped terms version), the stored date is used
--      and `p_date_of_birth` is ignored. Otherwise a member could re-answer
--      the age question with a different date at every terms bump.
--      Correcting a genuinely mistyped date is an operator action (service
--      role), deliberately not a self-service one.
--   6. Validates the date: not null, not in the future (by the same UTC-12
--      "today"), not before 1900-01-01. A garbage date is `invalid_date`, not
--      `underage` — it is not logged and does not trigger the final block.
--   7. Under 18 -> inserts ONE `age_gate_failures` row and returns
--      `{ok:false, reason:'underage'}`. Neither `date_of_birth` nor the terms
--      columns are written. The function RETURNS rather than RAISES so the
--      insert commits — a raise would roll the log row back with everything
--      else, which is the one outcome this branch must not have.
--   8. `p_terms_version` must equal the current version exactly, else
--      `terms_version_mismatch` (a stale page — reload and accept the current
--      text). Checked AFTER the age test on purpose: an under-18 submission
--      from a stale page is still an under-18 submission.
--   9. 18+ -> sets `date_of_birth` (only if it was null), `terms_accepted_at =
--      now()`, `terms_version = <current>`, returns `{ok:true}`.
--
--   18 is a literal, not an `app_config` row, on purpose. Every other number
--   in `app_config` is an operational threshold someone may need to tune
--   mid-event; the minimum age is a legal and policy commitment written into
--   the owner's Terms, and changing it should take a reviewed migration, not
--   a row edit.
--
-- WHY my_eligibility RETURNS `needs_age_gate` TRUE WHEN THE CONFIG ROW IS
-- MISSING
--   `needs_age_gate` is `date_of_birth is null OR terms_version is distinct
--   from <current> OR <current> is null`. The last clause is the fail-closed
--   one: without it, a deleted config row would make `null is distinct from
--   null` false and silently wave everybody through. With it, a missing row
--   gates everyone (and accept refuses everyone) — a loud, visible outage
--   fixed by one INSERT, which is the direction `packages/core/src/connect/
--   config.ts` already errs in for the same reason.
--
-- age_gate_failures — WHAT IS KEPT, AND THE RETENTION QUESTION IT RAISES
--   Exactly `user_id`, `attempted_dob`, `created_at` — "just enough to know it
--   happened, nothing more" (phase brief). At most one row per account, since
--   step 4 above stops logging once the block exists.
--
--   CASCADE on user delete, not SET NULL: a date of birth that is probably a
--   minor's, kept after its account is gone, would be retained personal data
--   about a child with no remaining purpose — the same "subject, not actor"
--   reasoning `card_preview_views` (20260815120100) gives for cascading.
--   Soft deletion (the only deletion the app performs) does not remove the
--   row, so the final block survives a delete-and-restore.
--
--   FLAGGED, NOT DECIDED HERE: how long this row should be kept, and whether
--   storing an under-18 person's self-reported date of birth at all needs to
--   be disclosed in the owner's privacy policy, is part of the same legal
--   review the amendment's §10/§12 already lists as a launch gate.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: EXECUTE on `public.accept_terms_and_confirm_age(date, text)` and
--     `public.my_eligibility()` to `authenticated` only. Both derive the
--     caller from the JWT and act on / answer about that one account only —
--     neither takes a user id, so neither can be pointed at anybody else.
--   Forbids: SELECT and UPDATE on `users.date_of_birth`,
--     `users.terms_accepted_at` and `users.terms_version` to every client
--     role, on every row including the caller's own (they are simply not
--     added to either column grant). Every privilege on `age_gate_failures`
--     to every client role. `private.age_in_years` is not executable by any
--     client role and lives in the unexposed `private` schema. `anon` gets
--     nothing, as everywhere in this schema.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. users — three new columns, deliberately absent from both column grants
-- ---------------------------------------------------------------------------
alter table public.users
  add column date_of_birth date,
  add column terms_accepted_at timestamptz,
  add column terms_version text;

comment on column public.users.date_of_birth is
  'Self-attested date of birth, captured once at the 18+/terms gate '
  '(20261009120000). WRITE-ONCE and readable by NO client role — outside both '
  'the authenticated SELECT and UPDATE column grants, exactly like is_admin. '
  'Only ever surfaced as a computed age, via public.my_eligibility().';

comment on column public.users.terms_accepted_at is
  'When this account last accepted the Terms at the 18+/terms gate. Written '
  'only by public.accept_terms_and_confirm_age; outside both client column '
  'grants (20261009120000).';

comment on column public.users.terms_version is
  'Which app_config.terms_current_version this account last accepted. A '
  'mismatch with the current value means the gate shows again. Outside both '
  'client column grants (20261009120000).';

-- ---------------------------------------------------------------------------
-- 2. app_config — the current terms version
-- ---------------------------------------------------------------------------
-- A JSON string, read with `value #>> '{}'` exactly as every numeric key is
-- read, so there is one access pattern for the whole table.
insert into public.app_config (key, value, description) values
  ('terms_current_version', '"1"'::jsonb,
   'The Terms/Privacy version members must have accepted (20261009120000). Bump it to force everyone through the 18+/terms gate again. Compared as exact text. A missing row gates everyone and lets nobody accept — fail closed, never a default.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. age_gate_failures — service-role only
-- ---------------------------------------------------------------------------
create table public.age_gate_failures (
  -- bigint identity like `rate_limit_events` / `card_preview_views`: nothing
  -- references this row and nothing fetches it by id, so §4.7 threat 5's
  -- uuid-not-sequential reasoning has no endpoint to apply to.
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  attempted_dob date not null,
  created_at timestamptz not null default now()
);

comment on table public.age_gate_failures is
  'One row per account that submitted an under-18 date of birth at the '
  '18+/terms gate (20261009120000). Its existence is the "final block": '
  'accept_terms_and_confirm_age refuses that account permanently. Forced RLS, '
  'zero policies, zero client grants — service role only. Retention is an '
  'open legal question (see the migration header).';

create index age_gate_failures_user_id_idx on public.age_gate_failures (user_id);

alter table public.age_gate_failures enable row level security;
alter table public.age_gate_failures force row level security;
revoke all on public.age_gate_failures from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. private.age_in_years — the single definition of "how old"
-- ---------------------------------------------------------------------------
-- Not `security definer`: it reads no table. `stable` because it depends on
-- now(). See the header for the UTC-12 "today" and the leap-day behaviour.
create or replace function private.age_in_years(p_date_of_birth date)
returns integer
language sql
stable
set search_path = ''
as $$
  select case
    when p_date_of_birth is null then null
    else extract(
      year from age(
        (((now() at time zone 'UTC') - interval '12 hours')::date)::timestamp,
        p_date_of_birth::timestamp
      )
    )::integer
  end;
$$;

comment on function private.age_in_years(date) is
  'Completed years of age as of the calendar date at UTC-12 (the westernmost '
  'date on Earth), so nobody is ever counted 18 before they are 18 '
  'everywhere. Leap-day birthdays turn over on 1 March. Null in, null out. '
  'The only age computation in the schema (20261009120000).';

revoke all on function private.age_in_years(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5a. public.accept_terms_and_confirm_age
-- ---------------------------------------------------------------------------
create or replace function public.accept_terms_and_confirm_age(
  p_date_of_birth date,
  p_terms_version text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_status text;
  v_existing_dob date;
  v_current_version text;
  v_today date := ((now() at time zone 'UTC') - interval '12 hours')::date;
  v_dob date;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select u.status, u.date_of_birth
    into v_status, v_existing_dob
  from public.users u
  where u.id = v_user
  for update;

  if not found or v_status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select nullif(btrim(a.value #>> '{}'), '')
    into v_current_version
  from public.app_config a
  where a.key = 'terms_current_version';

  if v_current_version is null then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;

  -- The final block (header, step 4). Not re-logged: one row per account.
  if exists (select 1 from public.age_gate_failures f where f.user_id = v_user) then
    return jsonb_build_object('ok', false, 'reason', 'underage');
  end if;

  -- Write-once (header, step 5).
  v_dob := coalesce(v_existing_dob, p_date_of_birth);

  if v_dob is null or v_dob > v_today or v_dob < date '1900-01-01' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_date');
  end if;

  if private.age_in_years(v_dob) < 18 then
    insert into public.age_gate_failures (user_id, attempted_dob)
    values (v_user, v_dob);
    return jsonb_build_object('ok', false, 'reason', 'underage');
  end if;

  if p_terms_version is distinct from v_current_version then
    return jsonb_build_object('ok', false, 'reason', 'terms_version_mismatch');
  end if;

  update public.users u
     set date_of_birth = coalesce(u.date_of_birth, v_dob),
         terms_accepted_at = now(),
         terms_version = v_current_version
   where u.id = v_user;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.accept_terms_and_confirm_age(date, text) is
  'The 18+/terms gate''s one write path (20261009120000). Caller from the JWT. '
  'Under 18 -> logs one age_gate_failures row, writes nothing else, and '
  'refuses that account permanently thereafter ({ok:false, reason:''underage''}). '
  '18+ with the current terms version -> records the date of birth (write-once) '
  'and the acceptance. Returns {ok, reason?}; never echoes a date of birth.';

revoke all on function public.accept_terms_and_confirm_age(date, text) from public, anon;
grant execute on function public.accept_terms_and_confirm_age(date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5b. public.my_eligibility
-- ---------------------------------------------------------------------------
create or replace function public.my_eligibility()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'needs_age_gate',
          u.date_of_birth is null
          or cfg.current_version is null
          or u.terms_version is distinct from cfg.current_version,
        'age', private.age_in_years(u.date_of_birth)
      )
      from public.users u
      left join lateral (
        select nullif(btrim(a.value #>> '{}'), '') as current_version
        from public.app_config a
        where a.key = 'terms_current_version'
      ) cfg on true
      where u.id = private.current_user_id()
    ),
    -- No JWT, or a JWT naming no row: gated, age unknown. Fail closed.
    jsonb_build_object('needs_age_gate', true, 'age', null)
  );
$$;

comment on function public.my_eligibility() is
  'The CALLER''s own gate state: {needs_age_gate: boolean, age: integer|null} '
  '(20261009120000). Self-only — takes no argument. Never returns the date of '
  'birth itself. A missing terms_current_version row reads as needs_age_gate '
  '= true for everyone (fail closed).';

revoke all on function public.my_eligibility() from public, anon;
grant execute on function public.my_eligibility() to authenticated;
