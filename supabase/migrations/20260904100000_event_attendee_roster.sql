-- =============================================================================
-- 20260904100000_event_attendee_roster.sql
--
-- WHAT THIS CHANGES
--   Builds the event attendee roster signed off in
--   `docs/architecture/2026-08-27-event-attendee-roster.md` — the one bounded
--   people-listing surface CLAUDE.md's non-negotiable "no directory" rule
--   carves out. Adds:
--     1. `users.roster_visibility` / `roster_visibility_chosen_at` — the
--        opt-in column, nullable, null = hidden (fail closed).
--     2. `event_roster_views` — private, write-only view-logging (§3.5).
--     3. Two `app_config` rate-limit rows (§3.6): 60 profile opens / 25
--        contact saves, per viewer, per event, per day.
--     4. `private.is_event_roster_member()` — the §3.1 population test (host,
--        `going` RSVP, or a claimed guest-list row).
--     5. `private.shares_event_with()` retrofitted with the opt-in gate
--        (§3.3's explicit, deliberate narrowing of an existing grant).
--     6. `public.event_roster()` and `public.event_attendee_profile()` — the
--        two new RPCs the roster UI reads.
--     7. `claim_event_import` gains an optional `p_roster_visibility`
--        parameter, so the claim-review screen can record the claimant's own
--        choice in the same statement as the claim.
--     8. `import_event_attendees`'s auto-attach block gets ONE MORE write —
--        see "THE RECORDED DEVIATION" below. This is the one place this
--        migration does not build the roster exactly as signed off.
--     9. Widens `rate_limit_events.subject_kind`'s CHECK to add `'user_event'`
--        — the roster's opens/saves budgets are keyed on a (viewer, event)
--        pair, which is not any of the five kinds that existed.
--
-- ===========================================================================
-- THE RECORDED DEVIATION — auto-attached and manually-claimed CSV attendees
-- default to VISIBLE, not hidden
-- ===========================================================================
--   §3.3 of the roster design is explicit: "no one can be exposed by anyone
--   else's action... two of your own actions stand between a CSV and your
--   name on a screen." A CSV-claimed attendee (manual claim OR auto-attach,
--   20260903140000) was meant to land exactly like an organic RSVP: opted-in
--   nowhere, `roster_visibility` null, invisible until they separately chose
--   otherwise.
--
--   The owner asked for the opposite: someone on an uploaded guest list
--   should show up on the roster once claimed, with no separate opt-in step.
--   This was flagged twice, via AskUserQuestion, before being built:
--
--     Round 1 — the conflict itself: auto-adding a CSV-claimed attendee to a
--     roster where strangers can view and save their phone/email, based only
--     on a host's upload (which nothing verifies actually happened), is
--     exactly the exposure §3.3 exists to prevent. The owner chose to skip
--     the opt-in for CSV-claimed attendees specifically anyway.
--
--     Round 2 — the concrete mechanism, since `roster_visibility` is a
--     single column on `users`, not scoped per event: setting it to
--     `'visible'` at claim time does not expose someone on the one event
--     they were imported into — it makes them visible on the roster of
--     EVERY event they ever attend afterward, silently, with no UI ever
--     having told them the setting exists. Given that, the owner chose:
--     auto-visible on claim, but the settings toggle (§Phase 3) still ships,
--     so once someone notices they can turn it off going forward. Not
--     consent up front — a way out, once they look.
--
--   THE CONCRETE SCENARIO THIS ENABLES, STATED PLAINLY (matching
--   20260903140000's own honesty about its own flagged risk): a host
--   uploads a CSV naming a real member's email, whether or not that person
--   actually attended — nothing checks that. If the email matches an
--   existing account, `import_event_attendees` already claims it silently
--   (20260903140000). After this migration, that same account's name,
--   photo, phone, email and social links become viewable and saveable by
--   every other opted-in attendee at every event it is ever claimed into —
--   not just this one — until the person happens to find the settings
--   toggle and turns it off. The manual claim-review screen (§Phase 3) is
--   less severe: there, the claimant sees the choice on the page in front
--   of them (still no pre-selection, per §8.4) rather than having it made
--   for them, so the deviation there is narrower — closer to "unusually
--   prominent default" than "no choice at all."
--
--   WHY THE WRITE IS STILL `coalesce`-GUARDED, NOT AN OVERWRITE. An account
--   that already made its OWN explicit choice — including a prior
--   `'hidden'` — is never overturned by a later claim, auto-attach or
--   otherwise. This is the one piece of §3.3's invariant that survives the
--   deviation intact: the CSV can set the untouched default, never override
--   a real decision the person already made.
--
-- ===========================================================================
-- WHY A NEW HELPER (`is_event_roster_member`), NOT REUSE OF EXISTING ONES
-- ===========================================================================
--   The roster's population (§3.1) — host, `going` RSVP, or claimed import —
--   is not identical to any existing helper. `private.can_see_event`
--   includes invited-but-not-answered and public-event visibility, neither
--   of which is "was here." `private.has_claimed_import_for_event`
--   (20260903150000) is only the claimed-import branch. This helper is
--   `security definer` for the same reason every other RLS-adjacent helper
--   in this schema is: it is called from within `event_roster` and
--   `event_attendee_profile`, which both need to see rows (`event_rsvps`,
--   `event_attendee_imports`) the caller cannot read directly.
--
-- ===========================================================================
-- WHY event_roster_views HAS ZERO POLICIES AND ZERO GRANTS
-- ===========================================================================
--   Matching `event_attendee_imports`' own posture exactly, for the same
--   reason: §3.5's decision is that this log is never read by app code, not
--   by the subject, not by the viewer, not by the host — only by the
--   service role, and only when investigating an actual incident. RLS
--   enabled AND forced with no policy at all means even a
--   service-role-equivalent bug in a future `security definer` function
--   cannot accidentally expose it through a SELECT this migration did not
--   anticipate; only an explicit `insert` (never a `select`) is written
--   anywhere in this migration's own functions. Retention/pruning (§3.5:
--   90 days) is not wired to a schedule by this migration — pg_cron is not
--   enabled on this project (same call `rate_limit_prune` already made) —
--   and is flagged here as a follow-up rather than silently assumed done.
--
-- ===========================================================================
-- WHY event_attendee_profile TAKES p_for_save RATHER THAN BEING TWO RPCS
-- ===========================================================================
--   Opening a profile and saving its contact are the same authorization
--   question (attendee, visible, started, not cancelled) against two
--   different rate-limit budgets and two different log entries. One RPC
--   with one auth code path, called twice by the client — once to render
--   the sheet, once immediately before building the vCard — means the
--   authorization logic exists in exactly one place rather than being kept
--   in sync across two functions.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: an attendee of a scheduled, started, non-cancelled event
--     (host, `going` RSVP, or claimed guest-list row) may now list that
--     event's OTHER opted-in attendees (names, photos only) via
--     `event_roster`, and open one opted-in attendee's card-preview-depth
--     profile (name, company, role, bio, phone, email, photo, social
--     links) via `event_attendee_profile`, rate-limited per §3.6. A claimed
--     CSV attendee (manual or auto) is now opted-in by default unless they
--     already chose otherwise — the recorded deviation above.
--     `private.shares_event_with` additionally now requires the SUBJECT to
--     be `roster_visibility = 'visible'` — a `hidden` or unanswered
--     co-attendee is no longer pairwise-readable through that branch of the
--     `users` policy either, which is a strictly TIGHTER position than
--     today's for anyone who opts out or stays unanswered.
--   Forbids: nobody may enumerate attendees before `starts_at`, including
--     the host; a `hidden`/unanswered subject appears on no roster and its
--     profile RPC refuses, indistinguishably from a rate-limited or
--     non-attendee refusal; nothing on this surface writes a `connections`,
--     `meetings`, or `connection_sessions` row — no code path here touches
--     any of the three; `event_roster_views` is readable by no client role
--     and no RPC in this migration ever selects from it.
--
-- VERIFIED LIVE in a rolled-back transaction before applying: a `visible`
--   co-attendee is now readable pairwise via `shares_event_with`, and a
--   `hidden`/unanswered one is not even though the RSVP-match condition is
--   true; `event_roster` returns nobody before `starts_at` (host included)
--   and the right, opted-in set at/after it, and nobody for a cancelled
--   event regardless of time; `event_attendee_profile` refuses identically
--   ({available:false}) for a hidden subject, a non-attendee caller, a
--   non-attendee subject, and a caller over budget; a manual claim passing
--   `p_roster_visibility = 'visible'` sets both new columns exactly once,
--   and a claim omitting the parameter leaves them null; an auto-attach
--   claim sets `roster_visibility = 'visible'` only when it was previously
--   null, and leaves a prior explicit `'hidden'` untouched; a fresh
--   `INSERT ... RETURNING` on `events` still works (unaffected by this
--   migration, checked anyway per the standing self-reference regression
--   discipline since this migration also touches `events`-reading
--   functions).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. users.roster_visibility
-- ---------------------------------------------------------------------------
alter table public.users
  add column roster_visibility text check (roster_visibility in ('visible', 'hidden')),
  add column roster_visibility_chosen_at timestamptz;

comment on column public.users.roster_visibility is
  'Opt-in choice for the event attendee roster (2026-08-27 design). Null or '
  '''hidden'' means invisible to co-attendees on every roster and through '
  'private.shares_event_with''s roster-gated branch. ''visible'' means '
  'opted in. Default is null (hidden) for every ordinary path — see '
  '20260904100000''s header for the one deviation (CSV claim defaults to '
  'visible unless already chosen).';

comment on column public.users.roster_visibility_chosen_at is
  'When roster_visibility was last set by the person''s own action or, for '
  'the recorded CSV-claim deviation, by a claim on their behalf. Null means '
  'never chosen — drives the one-time sign-in prompt (§Phase 3).';

grant select (roster_visibility, roster_visibility_chosen_at) on public.users to authenticated;
grant update (roster_visibility, roster_visibility_chosen_at) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- 2. event_roster_views — private, write-only (§3.5)
-- ---------------------------------------------------------------------------
create table public.event_roster_views (
  id uuid primary key default gen_random_uuid(),
  viewer_user_id uuid not null references public.users(id) on delete cascade,
  subject_user_id uuid not null references public.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  contact_saved boolean not null default false
);

create index event_roster_views_viewed_at_idx on public.event_roster_views (viewed_at);

comment on table public.event_roster_views is
  'Every roster profile open and contact save, logged for incident '
  'investigation only (§3.5). RLS forced with zero policies and zero '
  'grants — no app code path, including this migration''s own RPCs, ever '
  'SELECTs from this table, only INSERTs into it. Retention is designed as '
  '90 days (§3.5) but not yet wired to a schedule — pg_cron is not enabled '
  'on this project, matching rate_limit_prune''s own unscheduled posture.';

alter table public.event_roster_views enable row level security;
alter table public.event_roster_views force row level security;

revoke all on public.event_roster_views from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Rate-limit config (§3.6)
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value, description) values
  ('rate_limit_roster_profile_open_per_user_event_day', '60'::jsonb,
   'How many roster profile opens one viewer may make for one event per day (2026-08-27 design §3.6). The primary technical control against bulk contact harvesting now that roster views are logged privately with no visible deterrent.'),
  ('rate_limit_roster_contact_save_per_user_event_day', '25'::jsonb,
   'How many Save-to-Contacts downloads one viewer may make for one event per day (§3.6). Tighter than the open budget on purpose: a save is a durable copy that leaves the system, an open is only a look.')
on conflict (key) do nothing;

-- `rate_limit_events.subject_kind` is a deliberately closed set
-- (20260813210200: "a typo here would silently create a second, empty
-- counter"), widened once already for 'import' (20260828120000). The
-- resource being budgeted here is a (viewer, event) PAIR, not any existing
-- kind, so it gets a sixth value rather than overloading 'user'. Postgres
-- has no `alter constraint`; a CHECK is dropped and re-added, matching
-- 20260828120000's own pattern exactly.
alter table public.rate_limit_events drop constraint rate_limit_events_subject_kind_check;
alter table public.rate_limit_events add constraint rate_limit_events_subject_kind_check
  check (subject_kind in ('user', 'ip', 'card', 'session', 'import', 'user_event'));

-- ---------------------------------------------------------------------------
-- 4. private.is_event_roster_member — the §3.1 population test
-- ---------------------------------------------------------------------------
create or replace function private.is_event_roster_member(p_user_id uuid, p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and p_event_id is not null
     and exists (
       select 1
       from public.events e
       where e.id = p_event_id
         and (
           e.host_user_id = p_user_id
           or exists (
             select 1 from public.event_rsvps r
             where r.event_id = e.id and r.user_id = p_user_id and r.status = 'going'
           )
           or exists (
             select 1 from public.event_attendee_imports ei
             where ei.event_id = e.id and ei.claimed_by_user_id = p_user_id
           )
         )
     );
$$;

comment on function private.is_event_roster_member(uuid, uuid) is
  'The roster''s own population (§3.1): hosts, going RSVPs, and claimed '
  'guest-list rows. Not the same set as private.can_see_event (which also '
  'admits invited-but-unanswered and public browsing) — this answers "was '
  'this person actually here", which is a narrower and different question.';

revoke all on function private.is_event_roster_member(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. shares_event_with — retrofitted with the opt-in gate (§3.3)
-- ---------------------------------------------------------------------------
-- Deliberate narrowing of an eight-year-old-in-spirit grant, called out as
-- exactly that per the design doc's own instruction. Only the SUBJECT
-- (`other`) needs the gate — the viewer's own visibility choice has no
-- bearing on whether the viewer may look someone else up.
create or replace function private.shares_event_with(viewer uuid, other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select viewer is not null
     and other is not null
     and viewer <> other
     and coalesce(
       (select u.roster_visibility from public.users u where u.id = other),
       'hidden'
     ) = 'visible'
     and exists (
       select 1
       from public.event_rsvps mine
       join public.event_rsvps theirs on theirs.event_id = mine.event_id
       where mine.user_id = viewer
         and mine.status = 'going'
         and theirs.user_id = other
         and theirs.status = 'going'
     );
$$;

comment on function private.shares_event_with(uuid, uuid) is
  'True if both users RSVP''d going to the same event AND the subject '
  '(other) has opted into the roster (roster_visibility = ''visible'', '
  '20260904100000). A hidden or unanswered subject is no longer pairwise '
  'readable through this branch of the users policy either — a strictly '
  'tighter position than before this migration for anyone who opts out.';

-- ---------------------------------------------------------------------------
-- 6. event_roster — the listing RPC
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
  'of the 2026-08-27 roster design). Returns an EMPTY SET, never an error, '
  'for every refusal reason: caller not signed in, caller not an attendee, '
  'event not started yet (checked live against events.starts_at, never '
  'cached), or event cancelled — refuses identically for the host as for '
  'anyone else. No pending count, no RSVP status, no origin (RSVP vs '
  'claimed import) is exposed here or anywhere on this surface.';

revoke all on function public.event_roster(uuid) from public, anon;
grant execute on function public.event_roster(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. event_attendee_profile — the per-tap profile + Save-to-Contacts RPC
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
     or not private.is_event_roster_member(p_subject_user_id, p_event_id) then
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
  'opted in, event not started or cancelled, rate limit exhausted — '
  'collapses to the identical {available:false}, indistinguishably (§3.6). '
  'p_for_save selects the SAVES budget/log entry instead of the OPENS one; '
  'call once to render the sheet, once more with p_for_save=true '
  'immediately before building a vCard. Writes exactly one '
  'event_roster_views row per successful call and nothing else. No '
  'connect action exists anywhere downstream of this RPC.';

revoke all on function public.event_attendee_profile(uuid, uuid, boolean) from public, anon;
grant execute on function public.event_attendee_profile(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. claim_event_import — the claimant's own roster-visibility choice
-- ---------------------------------------------------------------------------
-- A NEW PARAMETER CHANGES THE FUNCTION'S SIGNATURE, SO `create or replace`
-- ALONE IS NOT ENOUGH. Postgres identifies a function by name AND parameter
-- TYPE LIST — (text, jsonb) and (text, jsonb, text) are two different
-- overloads, not one function replaced. Without the explicit `drop` below,
-- this statement would silently CREATE A SECOND, PARALLEL overload: the old
-- 2-argument version would keep existing (with its own EXECUTE grant,
-- unaware of roster_visibility), and a caller supplying only the original
-- two arguments would hit "function is not unique", since both overloads
-- would match. The drop, then a fresh grant below (a new overload starts
-- with NO grants, even though the old one had them) is the correct pattern.
drop function if exists public.claim_event_import(text, jsonb);

create or replace function public.claim_event_import(
  p_lookup_token text,
  p_approved_fields jsonb,
  p_roster_visibility text default null
)
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
  v_roster_visibility text;
  v_link jsonb;
begin
  if v_user is null then
    return jsonb_build_object('claimed', false);
  end if;

  select (value #>> '{}')::integer into v_per_user_limit
    from public.app_config where key = 'rate_limit_event_claim_per_user_hour';
  select (value #>> '{}')::integer into v_per_import_limit
    from public.app_config where key = 'rate_limit_event_claim_per_import_hour';

  if v_per_user_limit is null or v_per_import_limit is null then
    return jsonb_build_object('claimed', false);
  end if;

  if not public.rate_limit_consume(
       'event_claim', 'user', v_user::text, v_per_user_limit, 3600) then
    return jsonb_build_object('claimed', false);
  end if;

  select * into v_row
    from public.event_attendee_imports
   where lookup_token = p_lookup_token;

  if v_row.id is null then
    return jsonb_build_object('claimed', false);
  end if;

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

  v_keep_first_name   := coalesce((p_approved_fields ->> 'first_name')::boolean, false);
  v_keep_last_name    := coalesce((p_approved_fields ->> 'last_name')::boolean, false);
  v_keep_phone_number := coalesce((p_approved_fields ->> 'phone_number')::boolean, false);
  v_keep_company_name := coalesce((p_approved_fields ->> 'company_name')::boolean, false);
  v_keep_company_role := coalesce((p_approved_fields ->> 'company_role')::boolean, false);
  v_keep_social_links := coalesce((p_approved_fields ->> 'social_links')::boolean, false);

  -- Not a CSV field, unlike everything else approved above — this is the
  -- claimant's OWN choice, made on the review screen in front of them right
  -- now, so it is its own parameter rather than another p_approved_fields
  -- boolean. Any value other than the two real choices is treated as "no
  -- choice made" rather than raising on a malformed call.
  v_roster_visibility := case when p_roster_visibility in ('visible', 'hidden')
                               then p_roster_visibility else null end;

  -- THE ATOMIC CLAIM AND THE §2.2 DESTRUCTION, ONE STATEMENT — see
  -- 20260828130000's header. Unchanged from 20260903120000.
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
         lookup_token = null,
         emailed_at = null,
         email_error = null,
         email_send_claimed_at = null
   where id = v_row.id
     and claimed_by_user_id is null
     and expires_at > now();

  get diagnostics v_updated = row_count;

  if v_updated <> 1 then
    return jsonb_build_object('claimed', false);
  end if;

  update public.users
     set first_name   = case when v_keep_first_name   then coalesce(first_name,   v_row.first_name)   else first_name   end,
         last_name    = case when v_keep_last_name    then coalesce(last_name,    v_row.last_name)    else last_name    end,
         phone_number = case when v_keep_phone_number then coalesce(phone_number, v_row.phone_number) else phone_number end,
         company_name = case when v_keep_company_name then coalesce(company_name, v_row.company_name) else company_name end,
         company_role = case when v_keep_company_role then coalesce(company_role, v_row.company_role) else company_role end,
         -- The claimant's own roster choice (20260904100000). Coalesce-guarded
         -- like every other field here, so a re-claim attempt (already
         -- refused above by claimed_by_user_id is null, but stated for
         -- clarity) or a prior explicit choice by any other path is never
         -- overwritten.
         roster_visibility = coalesce(roster_visibility, v_roster_visibility),
         roster_visibility_chosen_at = coalesce(
           roster_visibility_chosen_at,
           case when v_roster_visibility is not null then now() end
         )
   where id = v_user;

  if v_keep_social_links then
    for v_link in select * from jsonb_array_elements(coalesce(v_row.social_links, '[]'::jsonb))
    loop
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

comment on function public.claim_event_import(text, jsonb, text) is
  'Claims an import row (§2.2/§3.8 of the 2026-08-22 import design): copies '
  'the fields named true in p_approved_fields into the caller''s own '
  'profile — filling blanks only, never overwriting — then destroys the '
  'row''s PII in the same statement as recording the claim. p_roster_visibility '
  '(20260904100000) records the claimant''s OWN roster opt-in choice, made '
  'on the review screen, coalesce-guarded so it never overrides an existing '
  'choice. Re-derives the full §3.2/§3.2.1 gate itself via '
  'private.import_claim_authorized. Returns {claimed: boolean} and nothing '
  'else — no reason, matching CardClaimResult for the same §3.6 reason.';

-- A fresh overload starts with no grants of its own — the old (text, jsonb)
-- function's grant does not carry over. Matches 20260828130000's own grant.
revoke all on function public.claim_event_import(text, jsonb, text) from public, anon;
grant execute on function public.claim_event_import(text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. import_event_attendees — the recorded deviation (see header)
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
    -- see 20260903140000's header for the reasoning and the flagged risk.
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

        -- THE RECORDED DEVIATION (20260904100000) — see this migration's
        -- header. Coalesce-guarded: never overrides an account's own prior
        -- explicit choice, including a prior 'hidden'.
        update public.users
           set roster_visibility = coalesce(roster_visibility, 'visible'),
               roster_visibility_chosen_at = coalesce(roster_visibility_chosen_at, v_now)
         where id = v_matched_user;
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
  'matching an existing ACTIVE account is auto-claimed immediately and '
  '(20260904100000, a recorded deviation from the roster design''s own §3.3 '
  '— see that migration''s header) defaults to roster-visible unless the '
  'account already chose otherwise. Returns counts only, including '
  'matched_existing_accounts. The approved/declined filter is applied by '
  'the CSV parser before rows reach here.';
