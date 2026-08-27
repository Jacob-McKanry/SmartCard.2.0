-- =============================================================================
-- 20260827130000_table_event_attendee_imports.sql
--
-- APPLIED to project `crpsbnbegeoqtlgshltt` on 2026-08-27 and verified live:
--   table present and empty, RLS enabled AND forced, zero policies, zero
--   grants to `authenticated` or `anon`, three config rows seeded. Migration
--   record's `version` corrected to match this filename.
--
--   Verified beforehand in a rolled-back transaction against the live database
--   as real users with real policies in force, across two runs. Run 1 (13
--   assertions) covered the gates: no attestation refused, another host's
--   event refused, an unverified host refused, and the importing host itself
--   unable to SELECT the table. Run 2 (9 assertions) covered merge and claim
--   semantics after the counting fix below: case-insensitive dedupe, later
--   rows filling blanks without clobbering earlier values, a re-upload leaving
--   a CLAIMED row untouched and reporting it as `skipped_already_claimed`, and
--   the RLS/grant posture. The gate code is byte-identical between the two
--   runs; only the loop body changed.
--
-- WHAT THIS CHANGES
--   Adds `public.event_attendee_imports`, three `app_config` rows, and
--   `public.import_event_attendees(uuid, jsonb, boolean)`.
--
--   Nothing existing is altered. The table is created with RLS enabled, FORCED,
--   and **no policy and no grant of any kind** — see the RLS section below.
--
-- WHY THIS EXISTS
--   `docs/architecture/2026-08-22-event-attendee-import.md` §2. A host exports
--   their guest list and uploads it; the people on it are later emailed and can
--   claim a pre-filled profile. This migration is the storage and the write
--   path only. Nothing reads these rows yet, nothing is emailed, and no profile
--   can be claimed — those are later slices.
--
-- ===========================================================================
-- THE MOST SENSITIVE TABLE IN THIS DATABASE, AND WHAT FOLLOWS FROM THAT
-- ===========================================================================
--   Every other table here holds data about people who signed up. This one
--   holds names, emails, phone numbers and employers belonging to people who
--   have never heard of SmartCard and never consented to us storing anything.
--   That single fact drives four decisions that would otherwise look
--   over-engineered:
--
--   1. NOBODY READS IT DIRECTLY. RLS is enabled and forced with zero policies,
--      and no role is granted SELECT. A policy-less forced-RLS table is
--      unreadable even by the table owner's ordinary queries, so the only way
--      in is a `security definer` function that checks something first. The
--      host is not exempt: they already hold the CSV they uploaded, so reading
--      it back through us adds nothing, while a grant would mean the PII
--      travels with whoever holds the host role later.
--   2. ROWS EXPIRE. `expires_at` is set from `app_config` at insert time
--      (180 days by default). Unclaimed rows are contact details for people who
--      never signed up, and holding them forever is the thing that turns this
--      feature into a liability. The purge itself is a later slice; the column
--      that makes it possible is here so no row is ever written without one.
--   3. THE HOST MUST ATTEST. `attested_at` is NOT NULL and the RPC refuses
--      unless the caller passes `p_attested => true`, so there is no code path
--      that writes a row without a recorded claim of authority to share those
--      contacts. It is the lawful basis, and it is per-import rather than
--      per-account so it cannot be granted once and forgotten.
--   4. IMPORTING IS GATED TWICE. The caller must be a verified host
--      (20260827120000) AND the host of this specific event. Verification says
--      "this person may import"; the host check says "into this event".
--
-- ===========================================================================
-- WHY THE approved / declined / invited FILTER IS **NOT** IN THIS FUNCTION
-- ===========================================================================
--   §2.3.1 of the design is emphatic that a `declined` row must never be
--   imported: it would record somebody the host turned away as having attended.
--   That filter lives in the TypeScript that parses the CSV, not here, and the
--   reason is that the status column is not ours. Luma spells it
--   `approval_status`, Eventbrite and Partiful spell it differently, and the
--   mapping screen lets the host say which values count. By the time rows reach
--   this function they are already the rows the host chose to import, so a
--   second filter here would have to re-derive a decision it does not have the
--   inputs for.
--
--   The honest consequence: a verified host CAN bypass the filter by calling
--   this RPC directly with addresses their export marked `declined`. That is
--   the malicious-verified-host case §9.4 already declines to solve — the same
--   host could equally retype those addresses into a fresh spreadsheet. The
--   filter protects against the accidental import, which is the realistic one,
--   and host verification protects against the malicious importer existing.
--
-- ===========================================================================
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
-- ===========================================================================
--   Grants: EXECUTE on `public.import_event_attendees` to `authenticated`,
--     which refuses every caller who is not a verified host of the named event.
--   Forbids: SELECT, INSERT, UPDATE and DELETE on
--     `public.event_attendee_imports` to every client role, with no policy that
--     could admit one. There is no read path to this table anywhere in this
--     migration — not for the host, not for an admin, not for the people whose
--     details are in it. Later slices add narrowly-checked readers.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Limits and retention, seeded rather than hardcoded
-- ---------------------------------------------------------------------------
-- Same argument as 20260815120000 and 20260821120000: a threshold that needs a
-- deploy to change is a threshold nobody changes on the night of a pilot event.
insert into public.app_config (key, value, description) values
  ('event_import_max_rows', '5000'::jsonb,
   'Maximum rows accepted in ONE import. A real guest list is hundreds; five thousand is well clear of that while still refusing a scraped list pasted in wholesale. Counted BEFORE any row is written, so an oversized upload writes nothing rather than the first N.'),

  ('event_import_unclaimed_retention_days', '180'::jsonb,
   'How long an UNCLAIMED import row survives before it is eligible for purge. Directly trades how well retroactive attendance history works (somebody who signs up a year later gets credited) against how long we hold contact details for people who never signed up. A product and legal call, not a technical one — see Q-A of the import design.'),

  ('rate_limit_event_import_per_host_day', '10'::jsonb,
   'Maximum imports ONE host may run per day, across all their events. Bounds the damage a compromised or newly-malicious verified-host account can do in a day to ten uploads rather than unlimited, without getting in the way of a host fixing a mistake by re-uploading a corrected file.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- public.event_attendee_imports
-- ---------------------------------------------------------------------------
create table if not exists public.event_attendee_imports (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: an import row for an event that no longer exists is not a fact
  -- worth keeping, and it is unconsented PII, so keeping it would be worse
  -- than useless. Matches `event_rsvps.event_id` and `event_invites.event_id`.
  event_id uuid not null references public.events(id) on delete cascade,

  -- The identity key, and `extensions.citext` for the same reason
  -- `users.email` is: matching must be case-insensitive, or Sarah@x.com and
  -- sarah@x.com become two different people and one of them can never claim.
  email extensions.citext not null,

  -- Everything below is nullable. A guest list may carry nothing but an email,
  -- and that is a valid import — the prefill is a convenience, not the point.
  first_name text,
  last_name text,
  phone_number text,
  company_name text,
  company_role text,

  -- `[{"platform": "...", "url": "..."}]`, normalised by the CSV parser from
  -- whatever columns the platform used. jsonb rather than rows in
  -- `social_links` because these are unverified strings belonging to a person
  -- who has not accepted them yet; they become real rows only on claim.
  social_links jsonb not null default '[]'::jsonb,

  -- What the emailed link carries. NOT a credential — the claim gate requires
  -- a verified matching address on top of it (§3.4 of the design). It is here
  -- so a link identifies one invitation without exposing an enumerable id.
  lookup_token text not null unique,

  -- SET NULL, not cascade: attribution of who imported, not a fact about them.
  imported_by_user_id uuid references public.users(id) on delete set null,
  imported_at timestamptz not null default now(),

  -- NOT NULL on purpose: there is no way to write a row without the host
  -- having asserted they may share these contacts. See the header.
  attested_at timestamptz not null,

  source text not null default 'csv',

  claimed_by_user_id uuid references public.users(id) on delete set null,
  claimed_at timestamptz,

  -- Set from app_config at insert time, never defaulted here, so changing the
  -- retention setting affects new imports without a migration.
  expires_at timestamptz not null,

  -- One row per person per event. Makes a re-upload of a corrected file an
  -- upsert rather than a duplicate, and makes the several-rows-per-guest case
  -- in a real Luma export (multiple ticket registrations under one guest) a
  -- no-op rather than an error.
  constraint event_attendee_imports_one_per_email_per_event unique (event_id, email),

  -- A claimed row has both a claimant and a timestamp, or neither.
  constraint event_attendee_imports_claim_is_complete check (
    (claimed_by_user_id is null and claimed_at is null)
    or (claimed_by_user_id is not null and claimed_at is not null)
  )
);

comment on table public.event_attendee_imports is
  'Guest-list rows uploaded by a verified host, holding contact details for '
  'people who have not signed up and never consented to us storing them (§2 of '
  'the 2026-08-22 attendee-import design). RLS is enabled and FORCED with no '
  'policy and no grant to any role: the only way in or out is a security '
  'definer function that checks something first. On claim, a later slice '
  'destroys the personal columns and keeps only the attendance fact.';

comment on column public.event_attendee_imports.lookup_token is
  'Identifies WHICH invitation an emailed link refers to. Deliberately not a '
  'credential: claiming additionally requires a verified email matching this '
  'row, because mail gets forwarded and a link that auto-claims lets anyone '
  'who ever sees the message take somebody''s data.';

comment on column public.event_attendee_imports.attested_at is
  'When the importing host asserted they may contact these people about this '
  'event. NOT NULL so no code path can write a row without it, and per-import '
  'rather than per-account so it cannot be granted once and forgotten.';

create index event_attendee_imports_event_id_idx
  on public.event_attendee_imports (event_id);

-- Drives the purge of expired unclaimed rows, and the "which events has this
-- address attended" lookup a later slice needs for retroactive history.
create index event_attendee_imports_unclaimed_expiry_idx
  on public.event_attendee_imports (expires_at)
  where claimed_by_user_id is null;

alter table public.event_attendee_imports enable row level security;
alter table public.event_attendee_imports force row level security;

-- Intentionally: no policy, and no grant. See the header. `force row level
-- security` makes this deny-all even for the owner's ordinary queries, so the
-- security definer functions are genuinely the only way in.

-- ---------------------------------------------------------------------------
-- import_event_attendees
-- ---------------------------------------------------------------------------
-- Returns a summary rather than rows: `{"imported": n, "updated": n,
-- "skipped_no_email": n, "skipped_already_claimed": n}`. The host just
-- uploaded this file, so telling them how it landed discloses nothing they did
-- not supply — and it is a count, not a list, which is the same line §3.9
-- draws for the status screen later. `skipped_already_claimed` in particular
-- is a count and must stay one: a per-person list of who has claimed would
-- disclose which of the host's guests hold SmartCard accounts.
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
  v_inserted boolean;
begin
  if v_user is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Gate one: may this person import at all (20260827120000)?
  if not exists (
    select 1 from public.users u
    where u.id = v_user and u.status = 'active' and u.is_verified_host
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Gate two: into THIS event? A cancelled event is excluded — mailing the
  -- guest list of an event that was called off is not something to enable.
  -- Refuses identically to gate one, so this cannot be used to discover
  -- whether an event id exists or who hosts it.
  if not exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.host_user_id = v_user
      and e.status <> 'cancelled'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- The attestation is a precondition, not a field. Refusing here rather than
  -- writing `attested_at = null` is why that column can be NOT NULL.
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

  -- Fail closed if a config row is missing rather than silently importing
  -- without a cap or writing a null expiry.
  if v_max_rows is null or v_retention_days is null or v_per_host_limit is null then
    raise exception 'import configuration missing' using errcode = '55000';
  end if;

  v_total := jsonb_array_length(p_rows);

  -- Checked BEFORE anything is written, so an oversized upload writes nothing
  -- rather than the first v_max_rows of it.
  if v_total > v_max_rows then
    raise exception 'that file has % rows; the limit is %', v_total, v_max_rows
      using errcode = '22023';
  end if;

  -- Per-host daily budget. Consumed before the work, so a refused import still
  -- spends its attempt — probing is not free. Same posture as
  -- `claim_unassigned_card`'s limits.
  if not public.rate_limit_consume(
       'event_import', 'user', v_user::text, v_per_host_limit, 86400) then
    raise exception 'too many imports today' using errcode = '53400';
  end if;

  v_expires := v_now + make_interval(days => v_retention_days);

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_email := btrim(coalesce(v_row ->> 'email', ''));

    -- No email means no identity and no way to ever claim. Skipped rather than
    -- refused, because one malformed line should not reject a whole guest list.
    if v_email = '' or position('@' in v_email) = 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Reset per iteration: a RETURNING that matches no row leaves a plpgsql
    -- variable holding its previous value, which would miscount the next row.
    v_inserted := null;

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
      -- 244 bits from two v4 UUIDs. Unguessable, and dependency-free —
      -- `gen_random_uuid` is core in PG13+, unlike pgcrypto's gen_random_bytes.
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
    -- A claimed row is the person's own record now. Re-uploading the file must
    -- not overwrite what they edited, and must not resurrect the PII the claim
    -- destroyed, so the update simply does not apply to claimed rows.
    where public.event_attendee_imports.claimed_by_user_id is null
    returning (xmax = 0) into v_inserted;

    -- `xmax = 0` distinguishes a fresh INSERT from an ON CONFLICT UPDATE, and
    -- no row returned at all means the conflict matched but the WHERE above
    -- refused it — i.e. that person has already claimed.
    --
    -- Counting this way rather than probing with a SELECT first is deliberate,
    -- and the probe version was a real bug caught in verification: under
    -- `search_path = ''` the `citext` equality operator is not resolvable, so
    -- `ei.email = v_email::extensions.citext` silently degraded to
    -- case-SENSITIVE text comparison and reported every duplicate as new. The
    -- unique index deduped correctly regardless — index operator classes do
    -- not depend on search_path — so only the counts were wrong, which is
    -- exactly the kind of quiet mismatch a summary shown to a host must not
    -- have. Deriving the answer from the write removes both the operator
    -- dependency and the race between probing and inserting.
    if not found then
      v_skipped_claimed := v_skipped_claimed + 1;
    elsif v_inserted then
      v_imported := v_imported + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'imported', v_imported,
    'updated', v_updated,
    'skipped_no_email', v_skipped,
    'skipped_already_claimed', v_skipped_claimed
  );
end;
$$;

comment on function public.import_event_attendees(uuid, jsonb, boolean) is
  'Writes guest-list rows for one event. Requires an ACTIVE VERIFIED host who '
  'hosts that specific (non-cancelled) event, and an explicit attestation. '
  'Upserts on (event_id, email) so a re-upload corrects rather than '
  'duplicates, and never touches a row somebody has already claimed. Returns '
  'counts only. The approved/declined filter is applied by the CSV parser '
  'before rows reach here — see this migration''s header for why.';

revoke all on function public.import_event_attendees(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_event_attendees(uuid, jsonb, boolean) to authenticated;
