-- =============================================================================
-- 20260829120000_fn_list_own_import_links.sql
--
-- WHAT THIS CHANGES
--   Adds `public.list_own_import_links(uuid, integer, integer)` and one
--   `app_config` rate-limit row. No table is created or altered. No policy is
--   added to `public.event_attendee_imports` and no role gains SELECT on it —
--   the table stays deny-all with forced RLS exactly as 20260827130000 left it.
--
-- ===========================================================================
-- THIS REVERSES A DECISION THIS PROJECT ALREADY MADE, ON PURPOSE. READ THIS.
-- ===========================================================================
--   §3.8 of `docs/architecture/2026-08-22-event-attendee-import.md`, and this
--   table's own migration header, both say the host may not read these rows
--   back:
--
--     "The host uploaded the CSV, so letting them read it back discloses
--      nothing new *today* — but a direct grant means the PII travels with
--      whoever holds the host role later, and survives any future change to
--      event ownership. A counts-only function costs nothing and removes that."
--
--   `attendee-import-service.ts` states the same thing as a property of the
--   codebase: "There is no `list` or `get` below and there cannot be one."
--
--   **Owner decision, 2026-08-29, recorded as a deviation in §11.5 of that
--   document.** §5's email phase — the thing that was going to deliver the
--   claim link to the guest — is not built. Until it is, a `lookup_token`
--   exists only in this table with no way out of it, which means the entire
--   claim flow (C2-C5, all built and all verified) cannot be exercised by a
--   real person at all. The only way to test it today is to query the database
--   by hand with the service role, outside the app.
--
--   So this is a deliberately temporary surface with one job: let the host who
--   uploaded a list hand a specific guest their own claim link, by whatever
--   channel they already use, until automated mail replaces it.
--
-- ===========================================================================
-- HOW THE ORIGINAL OBJECTION IS ANSWERED RATHER THAN OVERRULED
-- ===========================================================================
--   The objection quoted above is not "the host must never see this data" —
--   the host uploaded it. It is precisely and only that **the PII must not
--   travel with the host ROLE**, outliving the person who supplied it.
--
--   So the gate here is NOT "are you the host of this event". It is
--   `imported_by_user_id = private.current_user_id()`, evaluated per row:
--
--     - A host who takes over an event later reads NOTHING from an import
--       somebody else ran, even though they now hold the host role that
--       §3.8 worried about. The original objection's exact scenario is closed
--       by construction, not by policy.
--     - A co-host, an admin, and the service role are equally shut out. There
--       is no argument of the form "but they are also a host now".
--     - `imported_by_user_id` is `on delete set null`, so if the importer's
--       account is deleted the rows become unreadable to everybody forever —
--       null is never equal to a caller id. That is the correct direction: the
--       one person who could justify reading them is gone.
--
--   Verified-host standing is ALSO required, re-derived here rather than
--   assumed from the import that wrote the rows. A host whose verification is
--   revoked for abuse must stop being able to pull the tokens for the list
--   they already uploaded, not merely stop uploading new ones.
--
-- ===========================================================================
-- WHAT IS RETURNED, AND WHY EACH FIELD IS THE MINIMUM
-- ===========================================================================
--   `email`, `first_name`, `last_name`, `lookup_token` — and nothing else.
--
--   `lookup_token` is the point: it is what a claim URL carries. Handing it to
--   the person who uploaded the row is not a new disclosure of anybody's
--   contact details; it is a disclosure of OUR OWN identifier for an
--   invitation that this host is the reason exists.
--
--   `email` is here because without it this list cannot do its job. The host
--   has to know WHERE to send a link, and a guest list may legitimately carry
--   nothing but an address (20260827130000: "A guest list may carry nothing
--   but an email, and that is a valid import"), so a name is not a usable
--   identifier for every row. It discloses nothing: it is the exact string
--   this caller uploaded, returned to the caller who uploaded it.
--
--   `phone_number`, `company_name`, `company_role` and `social_links` are
--   deliberately NOT returned. They are in the host's own CSV already and
--   nothing about sending a link needs them, so returning them would be a
--   second copy of contact details behind a second set of checks for no
--   purpose — which is the thing §3.8 objected to, and the part of it that
--   still stands.
--
--   `claimed_by_user_id` and any claimed row are NOT returned, at all, and
--   this is a §3.9 rule rather than a convenience: a per-person "claimed ✓"
--   would tell the host which of their guests hold SmartCard accounts, which
--   is a fact about those people that they did not give the host. Filtering to
--   unclaimed rows means the list shrinks as people claim, and the host learns
--   only "this one still needs a link" — never "this specific person joined".
--   The COUNT of remaining unclaimed rows is returned, matching the aggregate
--   line §3.9 already permits.
--
--   Expired rows are excluded for the same reason the claim RPCs refuse them:
--   a link that cannot be claimed is worse than no link, because the host
--   sends it and the guest hits a dead end.
--
-- ===========================================================================
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
-- ===========================================================================
--   Grants: EXECUTE on `public.list_own_import_links` to `authenticated`,
--     which returns rows only to the account that imported them, and only
--     while that account is still an active verified host of the named
--     non-cancelled event.
--   Forbids: everything else, unchanged. `anon` holds no grant. No role gains
--     SELECT, INSERT, UPDATE or DELETE on `public.event_attendee_imports`, and
--     that table still has zero policies under forced RLS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Rate limit, seeded rather than hardcoded — same argument as every prior
-- app_config addition in this feature.
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value, description) values
  ('rate_limit_import_links_per_host_hour', '120'::jsonb,
   'Maximum calls to list_own_import_links ONE account may make per hour, across all of their events. This is a paged list a host scrolls and copies from one row at a time, so the ceiling has to clear ordinary use comfortably — it exists to bound a compromised host account being used to vacuum every claim token it can reach, not to ration normal reading.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- public.list_own_import_links
-- ---------------------------------------------------------------------------
-- Paged rather than unbounded: `event_import_max_rows` is 5000, and a function
-- that can be made to return five thousand rows of contact details plus five
-- thousand claim tokens in one call is a different thing from one that returns
-- a screenful. The page size is clamped here rather than trusted from the
-- caller, so a hand-written `p_limit => 100000` gets a page, not the table.
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

  -- Gate one: may this person import at all? Re-derived rather than inferred
  -- from the fact that they once did — see the header on revoked verification.
  if not exists (
    select 1 from public.users u
    where u.id = v_user and u.status = 'active' and u.is_verified_host
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Gate two: into THIS event? Identical refusal to gate one, so a guessed
  -- event id cannot be used to discover whether it exists or who hosts it
  -- (§3.6). Cancelled events are excluded exactly as they are for import:
  -- circulating claim links for an event that was called off is not something
  -- to enable.
  if not exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.host_user_id = v_user
      and e.status <> 'cancelled'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select (value #>> '{}')::integer into v_per_host_limit
    from public.app_config where key = 'rate_limit_import_links_per_host_hour';

  -- Fail closed (CLAUDE.md): a missing config row refuses rather than serving
  -- claim tokens with no limit at all.
  if v_per_host_limit is null then
    raise exception 'import link configuration missing' using errcode = '55000';
  end if;

  -- Consumed BEFORE the read, so a refused or empty call still spends its
  -- budget and enumeration stays non-free — the same posture as every other
  -- limit in this feature.
  if not public.rate_limit_consume(
       'import_links', 'user', v_user::text, v_per_host_limit, 3600) then
    raise exception 'too many requests' using errcode = '53400';
  end if;

  -- Clamped, not trusted. `least` caps the page; `greatest` turns a null,
  -- zero or negative argument into something coherent rather than into
  -- "no limit" or a Postgres error the caller could distinguish.
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  -- The aggregate §3.9 permits: how many of this caller's own imported guests
  -- have not claimed yet. Never a list of who HAS.
  select count(*) into v_remaining
    from public.event_attendee_imports ei
   where ei.event_id = p_event_id
     and ei.imported_by_user_id = v_user
     and ei.claimed_by_user_id is null
     and ei.expires_at > now();

  select coalesce(jsonb_agg(r order by r.sort_email), '[]'::jsonb) into v_rows
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
     -- Ordered by email rather than by name or import order: it is the one
     -- column guaranteed non-null on every row, so paging is stable. A
     -- nullable sort key would let a row appear on two pages or on none.
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
  'their own events, so they can pass a link on by hand until the email phase '
  '(§5 of the 2026-08-22 attendee-import design) exists. Deliberately gated on '
  'imported_by_user_id rather than on holding the host role, so the data does '
  'not travel with the role to a later host — which is the exact objection '
  '§3.8 raised against any host read path. Returns only unclaimed, unexpired '
  'rows, and only the four fields a person needs to send somebody a link. See '
  'this migration''s header, and §11.5 of the design doc, for the full '
  'deviation record.';

revoke all on function public.list_own_import_links(uuid, integer, integer) from public, anon;
grant execute on function public.list_own_import_links(uuid, integer, integer) to authenticated;
