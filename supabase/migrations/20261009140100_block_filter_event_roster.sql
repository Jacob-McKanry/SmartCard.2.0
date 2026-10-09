-- =============================================================================
-- 20261009140100_block_filter_event_roster.sql
--
-- THIS IS THE SAME DELIBERATE AMENDMENT, APPLIED TO THE EVENT ROSTER.
--   20260809211100: "if the answer is yes and blocking should also hide
--   profiles, that is a deliberate amendment to this policy, not something to
--   slip in here." Q4 is answered yes (owner decision 4 of
--   `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`), with
--   blocking applied to "the app's existing feed/roster/profile read paths".
--   20261009140000 made the amendment for the `users` row and the photo
--   policy's `can_see_user` branch; this file makes it for the roster, which
--   is the one people-LISTING surface CLAUDE.md permits
--   (`docs/architecture/2026-08-27-event-attendee-roster.md`). Part 4 of 5 of
--   the amendment's Phase 2.
--
--   Read against the roster design before changing anything here, per
--   CLAUDE.md. This change is a pure NARROWING of who appears to whom; it
--   does not widen the roster in any of the four ways that document says
--   would need a new amendment (pre-event visibility, cross-event listing,
--   non-attendee readers, a connect action). No column of what the roster
--   returns changes.
--
-- WHAT THIS CHANGES — all three on the RELATIONSHIP test only (none of the
-- three has a self branch: each already excludes the caller from its own
-- results)
--   1. `private.shares_roster_event_with(viewer, other)` — the second branch
--      of the `profile-photos` storage SELECT policy (20260904110000) — gains
--      `and not private.blocked_either_way(viewer, other)`. With
--      20261009140000 this closes the photo on BOTH storage branches.
--   2. `public.event_roster(event_id)` stops listing a co-attendee when either
--      of the two has blocked the other.
--   3. `public.event_attendee_profile(event_id, subject, for_save)` refuses a
--      blocked pair with the same `{available:false}` it already returns for
--      every other refusal — hidden subject, non-attendee, not started,
--      cancelled, over budget. The block test sits with the other subject
--      tests, BEFORE the rate-limit consumption and BEFORE the
--      `event_roster_views` insert, so a refused open neither spends budget
--      nor writes a view-log row (both only ever happen on the success path,
--      unchanged). Every other line of the function is byte-for-byte the live
--      20260904100000 definition (compared against `pg_get_functiondef`
--      before writing this).
--
-- WHY THE REFUSAL MUST BE INDISTINGUISHABLE
--   The roster design's §3.6 rule — every refusal collapses to one shape — is
--   what stops the roster being used as an oracle. A distinct "blocked"
--   answer would tell the blocked person exactly what happened, which the
--   `blocks` table's own design (no read branch on `blocked_user_id`) exists
--   to prevent. A blocked co-attendee simply is not on the list, exactly like
--   one who opted out.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: nothing. EXECUTE grants on all three functions are unchanged
--     (`create or replace` keeps them).
--   Forbids, newly, to every `authenticated` caller including a host: seeing
--     a person on an event's roster, opening their roster profile, saving
--     their contact, or reading their photo through the roster branch of the
--     storage policy, when either of the two has blocked the other.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. private.shares_roster_event_with — second revision
-- ---------------------------------------------------------------------------
create or replace function private.shares_roster_event_with(p_viewer uuid, p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_viewer is not null
     and p_other is not null
     and p_viewer <> p_other
     -- Amended 20261009140100 (the deliberate block-filtering amendment).
     and not private.blocked_either_way(p_viewer, p_other)
     and coalesce(
       (select u.roster_visibility from public.users u where u.id = p_other),
       'hidden'
     ) = 'visible'
     and exists (
       select 1
       from public.events e
       where e.status <> 'cancelled'
         and e.starts_at <= now()
         and private.is_event_roster_member(p_viewer, e.id)
         and private.is_event_roster_member(p_other, e.id)
     );
$$;

comment on function private.shares_roster_event_with(uuid, uuid) is
  'Whether p_viewer and p_other are both members (host, going RSVP, or claimed '
  'guest-list row — private.is_event_roster_member) of the same live, '
  'non-cancelled event, with p_other opted into the roster '
  '(roster_visibility = ''visible''), and neither has blocked the other '
  '(20261009140100). Backs ONLY the profile-photos storage SELECT policy — not '
  'called from the users SELECT policy, which stays on the narrower rule (see '
  '20260904110000''s header).';

-- ---------------------------------------------------------------------------
-- 2. public.event_roster — second revision
-- ---------------------------------------------------------------------------
create or replace function public.event_roster(p_event_id uuid)
returns table (user_id uuid, first_name text, last_name text, photo_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.first_name, u.last_name, u.photo_path
  from public.users u
  where private.current_user_id() is not null
    and p_event_id is not null
    and u.id <> private.current_user_id()
    and u.status = 'active'
    and u.roster_visibility = 'visible'
    -- Amended 20261009140100 (the deliberate block-filtering amendment).
    and not private.blocked_either_way(private.current_user_id(), u.id)
    and private.is_event_roster_member(u.id, p_event_id)
    and private.is_event_roster_member(private.current_user_id(), p_event_id)
    and exists (
      select 1 from public.events e
      where e.id = p_event_id
        and e.status <> 'cancelled'
        and e.starts_at <= now()
    );
$$;

comment on function public.event_roster(uuid) is
  'Lists opted-in co-attendees of an event, excluding the caller (§3.1-3.2 '
  'of the 2026-08-27 roster design) and excluding anyone either side has '
  'blocked (20261009140100). Returns an EMPTY SET, never an error, for every '
  'refusal reason: caller not signed in, caller not an attendee, event not '
  'started yet (checked live against events.starts_at, never cached), or '
  'event cancelled — refuses identically for the host as for anyone else. No '
  'pending count, no RSVP status, no origin (RSVP vs claimed import) is '
  'exposed here or anywhere on this surface.';

-- ---------------------------------------------------------------------------
-- 3. public.event_attendee_profile — second revision
-- ---------------------------------------------------------------------------
create or replace function public.event_attendee_profile(
  p_event_id uuid,
  p_subject_user_id uuid,
  p_for_save boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_viewer uuid := private.current_user_id();
  v_event public.events%rowtype;
  v_subject public.users%rowtype;
  v_limit_key text;
  v_limit integer;
  v_action text;
  v_social jsonb;
begin
  if v_viewer is null or p_event_id is null or p_subject_user_id is null
     or v_viewer = p_subject_user_id then
    return jsonb_build_object('available', false);
  end if;

  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null or v_event.status = 'cancelled' or v_event.starts_at > now() then
    return jsonb_build_object('available', false);
  end if;

  if not private.is_event_roster_member(v_viewer, p_event_id) then
    return jsonb_build_object('available', false);
  end if;

  select * into v_subject from public.users where id = p_subject_user_id;
  if v_subject.id is null
     or v_subject.status <> 'active'
     or coalesce(v_subject.roster_visibility, 'hidden') <> 'visible'
     or not private.is_event_roster_member(p_subject_user_id, p_event_id)
     -- Amended 20261009140100 (the deliberate block-filtering amendment).
     -- Same refusal shape as every other reason; checked before any budget
     -- is spent or any view is logged.
     or private.blocked_either_way(v_viewer, p_subject_user_id) then
    return jsonb_build_object('available', false);
  end if;

  v_action := case when p_for_save then 'roster_contact_save' else 'roster_profile_open' end;
  v_limit_key := case when p_for_save
                       then 'rate_limit_roster_contact_save_per_user_event_day'
                       else 'rate_limit_roster_profile_open_per_user_event_day' end;

  select (value #>> '{}')::integer into v_limit
    from public.app_config where key = v_limit_key;

  if v_limit is null then
    return jsonb_build_object('available', false);
  end if;

  if not public.rate_limit_consume(
       v_action, 'user_event', v_viewer::text || ':' || p_event_id::text, v_limit, 86400) then
    return jsonb_build_object('available', false);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', s.id, 'platform', s.platform, 'url', s.url)
      order by s.display_order
    ),
    '[]'::jsonb
  )
    into v_social
  from public.social_links s
  where s.user_id = p_subject_user_id;

  -- The one and only write to event_roster_views (§3.5) — no function
  -- anywhere in this schema ever SELECTs from it.
  insert into public.event_roster_views (viewer_user_id, subject_user_id, event_id, contact_saved)
  values (v_viewer, p_subject_user_id, p_event_id, coalesce(p_for_save, false));

  return jsonb_build_object(
    'available', true,
    'first_name', v_subject.first_name,
    'last_name', v_subject.last_name,
    'company_name', v_subject.company_name,
    'company_role', v_subject.company_role,
    'bio', v_subject.bio,
    'phone_number', v_subject.phone_number,
    'email', v_subject.email,
    'photo_path', v_subject.photo_path,
    'social_links', v_social
  );
end;
$$;

comment on function public.event_attendee_profile(uuid, uuid, boolean) is
  'The card-preview-depth profile of one opted-in co-attendee (§3.4). Every '
  'refusal reason — not an attendee, subject not an attendee, subject not '
  'opted in, either side has blocked the other (20261009140100), event not '
  'started or cancelled, rate limit exhausted — collapses to the identical '
  '{available:false}, indistinguishably (§3.6). p_for_save selects the SAVES '
  'budget/log entry instead of the OPENS one; call once to render the sheet, '
  'once more with p_for_save=true immediately before building a vCard. '
  'Writes exactly one event_roster_views row per successful call and nothing '
  'else. No connect action exists anywhere downstream of this RPC.';
