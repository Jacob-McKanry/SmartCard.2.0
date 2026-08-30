-- =============================================================================
-- 20260830150000_events_draft_status.sql
--
-- WHAT THIS CHANGES
--   Adds `'draft'` to `events.status` (previously `scheduled` | `cancelled`,
--   20260815130100). Adds `status` to the column-level INSERT grant on
--   `events` so a host may choose `draft` or `scheduled` at creation time.
--   Adds `public.publish_event(uuid)`, the only way a draft ever becomes
--   `scheduled`. Updates three existing functions
--   (`private.can_see_event`, `public.import_event_attendees`,
--   `public.list_own_import_links`) to require `status = 'scheduled'`
--   wherever they previously accepted anything but `'cancelled'` — see below
--   for why that one-word change is the entire security-relevant part of
--   this migration.
--
-- WHY THIS EXISTS
--   Owner request, 2026-08-30: a host should be able to save an in-progress
--   event without it being live for anyone else yet. The create form's fields
--   are unchanged — a draft is not a relaxed-validation event, it is an
--   ordinary complete event that simply is not published — so this is a
--   status/visibility change, not a schema-of-required-fields change.
--
-- ===========================================================================
-- THE SECURITY-RELEVANT PART: EVERY PLACE THAT USED TO SAY "NOT CANCELLED"
-- HAS TO SAY "IS SCHEDULED" INSTEAD, OR A DRAFT LEAKS
-- ===========================================================================
--   `private.can_see_event`'s public branch (20260815130200) reads
--   `e.visibility = 'public' and e.status <> 'cancelled'`. A `draft` row is
--   NOT `cancelled`, so if this were left alone, a draft with
--   `visibility = 'public'` would be readable by any authenticated user the
--   instant it was saved — the opposite of the entire point of a draft. The
--   fix is not "also exclude draft"; it is that the branch's real intent was
--   always "this event is live", and `status = 'scheduled'` says that
--   directly. It excludes `cancelled` for free (same as before) and excludes
--   `draft` as a consequence of asking the right question instead of two
--   wrong ones stacked together.
--
--   The identical mistake was available in two more places, both fixed the
--   same way: `import_event_attendees`'s gate two ("into THIS event", host
--   must own a non-cancelled event) and `list_own_import_links`'s identical
--   gate. Importing a guest list into a draft, or handing out claim links for
--   one, makes no sense before the event is real to anyone but its host — and
--   without this fix, the check as written would have silently allowed both.
--
--   Every other read path (the host's own branch of `can_see_event`, and
--   `event_rsvp_queue`/`decide_event_rsvp`/`request_event_rsvp`, all of which
--   only ever act on rows `can_see_event` already admitted) inherits the fix
--   for free by going through `can_see_event`, and needed no direct edit.
--
-- ===========================================================================
-- WHY `status` GOES IN THE INSERT GRANT, NOT BEHIND A NEW RPC
-- ===========================================================================
--   Every OTHER status-shaped field this schema has treated as sensitive
--   (`users.is_admin`, `users.is_verified_host`, `events.status` moving TO
--   `cancelled`) is RPC-only, because those are privilege flags or represent
--   a fact the DATABASE must assert rather than the client. `draft` vs
--   `scheduled` at CREATE time is neither: it is the host's own choice about
--   their own not-yet-public event, the same kind of choice `visibility`
--   already is via an ordinary column grant. Zod (`eventInsertSchema` in
--   `@smartcard/types`) restricts the client to exactly `draft` | `scheduled`
--   before this is ever reached; `events_status_check` below restricts it a
--   second time in the database, so a client cannot write `cancelled` at
--   insert time by any route, hand-built request included.
--
--   PUBLISHING (draft -> scheduled) is different and DOES need an RPC:
--   `status` stays OUT of the column-level UPDATE grant, exactly as before
--   this migration, so an ordinary PATCH cannot flip it in either direction.
--   `publish_event` is the one-way, one-purpose door: it re-derives the
--   caller's host standing itself and only ever moves a row from `draft` to
--   `scheduled`, never the reverse and never touching `cancelled`.
--
-- ===========================================================================
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
-- ===========================================================================
--   Grants: `status` added to the INSERT column grant on `events` — a host
--     may create an event as `draft` or `scheduled` (never `cancelled`,
--     blocked by CHECK regardless of what the grant would otherwise permit).
--     EXECUTE on `public.publish_event(uuid)` to `authenticated`, which
--     refuses anybody who is not that event's host and refuses any event not
--     currently `draft`.
--   Forbids: `status` remains outside the UPDATE grant — no ordinary PATCH
--     changes it, in either direction. A draft event gains no new reader:
--     `can_see_event`'s host/RSVP/invite branches already covered the host
--     regardless of status, and the public branch now excludes drafts by the
--     same fix that keeps excluding cancelled events.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- events.status: add 'draft'
-- ---------------------------------------------------------------------------
alter table public.events
  drop constraint events_status_check;

alter table public.events
  add constraint events_status_check
  check (status in ('scheduled', 'cancelled', 'draft'));

-- The three-column cancellation-completeness check (20260815130100) only had
-- two branches; a draft row would satisfy neither and every insert/update
-- touching a draft would fail this CHECK outright without a third branch.
alter table public.events
  drop constraint events_cancellation_is_complete;

alter table public.events
  add constraint events_cancellation_is_complete check (
    (status = 'cancelled' and cancelled_at is not null and cancelled_reason is not null)
    or (status = 'scheduled' and cancelled_at is null and cancelled_reason is null)
    or (status = 'draft' and cancelled_at is null and cancelled_reason is null)
  );

comment on column public.events.status is
  'scheduled | cancelled | draft (20260830150000). draft is client-settable at '
  'INSERT only (never at UPDATE, never to/from cancelled) and means the host '
  'has saved the event but not published it: private.can_see_event''s public '
  'branch requires status = ''scheduled'', so a draft is invisible to anyone '
  'but its host regardless of its own visibility column. '
  'public.publish_event(uuid) is the only path from draft to scheduled.';

grant insert (status) on public.events to authenticated;

-- ---------------------------------------------------------------------------
-- public.publish_event — the only door from draft to scheduled
-- ---------------------------------------------------------------------------
create or replace function public.publish_event(p_event_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
begin
  if v_user is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- One UPDATE, gated on both the caller being the host AND the row currently
  -- being a draft. `no data found` covers "not your event", "no such event"
  -- and "already published" identically — the row simply does not match, so
  -- this cannot be used to learn which of the three is true, matching the
  -- refusal posture the rest of this schema already uses for RPCs reachable
  -- with a guessed id.
  update public.events
     set status = 'scheduled'
   where id = p_event_id
     and host_user_id = v_user
     and status = 'draft';

  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;

comment on function public.publish_event(uuid) is
  'Moves ONE event from draft to scheduled. Host-only, and only from draft — '
  'refuses identically for "not your event", "no such event", and "already '
  'published", so a guessed id cannot be used to probe which is true. The only '
  'writer of events.status besides soft_delete_own_account''s cancellation and '
  'the client-settable INSERT of draft|scheduled.';

revoke all on function public.publish_event(uuid) from public, anon;
grant execute on function public.publish_event(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- private.can_see_event — the public branch now requires LIVE, not merely
-- not-cancelled. This is the fix that keeps a draft from leaking.
-- ---------------------------------------------------------------------------
create or replace function private.can_see_event(viewer uuid, p_event_id uuid)
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
         and (
           -- Amended 20260830150000: was `status <> 'cancelled'`, which would
           -- have admitted a public DRAFT to any authenticated caller. The
           -- real intent was always "this event is live to the world";
           -- `status = 'scheduled'` says that directly and excludes both
           -- cancelled and draft as a consequence, not as two rules stacked.
           (e.visibility = 'public' and e.status = 'scheduled')
           or e.host_user_id = viewer
           or exists (
             select 1
             from public.event_rsvps r
             where r.event_id = e.id
               and r.user_id = viewer
           )
           or exists (
             select 1
             from public.event_invites i
             where i.event_id = e.id
               and i.invited_user_id = viewer
           )
         )
     );
$$;

comment on function private.can_see_event(uuid, uuid) is
  'Whether a viewer may see an event: LIVE public events (status = scheduled, '
  'amended 20260830150000 to also exclude drafts, not only cancelled events) '
  'to any authenticated user (deliberate exception, §2.6), plus — regardless '
  'of status — the host, anyone holding an RSVP row, and anyone holding an '
  'event_invites row. A draft or a cancelled event therefore leaves browse but '
  'stays in front of the host and anyone already counting on it.';

-- ---------------------------------------------------------------------------
-- import_event_attendees — gate two, amended the same way
-- ---------------------------------------------------------------------------
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

  if not exists (
    select 1 from public.users u
    where u.id = v_user and u.status = 'active' and u.is_verified_host
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Gate two: into THIS event? Amended 20260830150000 — was
  -- `status <> 'cancelled'`, which admitted a draft. Importing a guest list
  -- into an event nobody but the host can see yet is not a case to allow;
  -- `status = 'scheduled'` is the same "must be live" fix can_see_event got.
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
    returning (xmax = 0) into v_inserted;

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
  'hosts that specific LIVE event (status = scheduled, amended 20260830150000 '
  'to also exclude drafts), and an explicit attestation. Upserts on '
  '(event_id, email) so a re-upload corrects rather than duplicates, and never '
  'touches a row somebody has already claimed. Returns counts only.';

-- ---------------------------------------------------------------------------
-- list_own_import_links — gate two, amended the same way
-- ---------------------------------------------------------------------------
create or replace function public.list_own_import_links(
  p_event_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_limit integer;
  v_offset integer;
  v_per_host_limit integer;
  v_remaining bigint;
  v_rows jsonb;
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

  -- Gate two, amended 20260830150000 for the same reason import_event_attendees
  -- was: a draft is not a case where handing out claim links makes sense.
  if not exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.host_user_id = v_user
      and e.status = 'scheduled'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select (value #>> '{}')::integer into v_per_host_limit
    from public.app_config where key = 'rate_limit_import_links_per_host_hour';

  if v_per_host_limit is null then
    raise exception 'import link configuration missing' using errcode = '55000';
  end if;

  if not public.rate_limit_consume(
       'import_links', 'user', v_user::text, v_per_host_limit, 3600) then
    raise exception 'too many requests' using errcode = '53400';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  select count(*) into v_remaining
    from public.event_attendee_imports ei
   where ei.event_id = p_event_id
     and ei.imported_by_user_id = v_user
     and ei.claimed_by_user_id is null
     and ei.expires_at > now();

  select coalesce(jsonb_agg(page.r order by page.sort_email), '[]'::jsonb) into v_rows
    from (
      select
        jsonb_build_object(
          'first_name', ei.first_name,
          'last_name', ei.last_name,
          'email', ei.email::text,
          'lookup_token', ei.lookup_token
        ) as r,
        ei.email::text as sort_email
      from public.event_attendee_imports ei
     where ei.event_id = p_event_id
       and ei.imported_by_user_id = v_user
       and ei.claimed_by_user_id is null
       and ei.expires_at > now()
     order by ei.email::text
     limit v_limit offset v_offset
    ) as page;

  return jsonb_build_object(
    'unclaimed_total', v_remaining,
    'links', v_rows
  );
end;
$$;

comment on function public.list_own_import_links(uuid, integer, integer) is
  'Returns the pending claim links for guests THIS CALLER imported into one of '
  'their own LIVE events (status = scheduled, amended 20260830150000 to also '
  'exclude drafts). Deliberately gated on imported_by_user_id rather than on '
  'holding the host role — see this function''s original header, unchanged, '
  'in 20260829120000.';
