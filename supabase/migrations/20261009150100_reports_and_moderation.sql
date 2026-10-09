-- =============================================================================
-- 20261009150100_reports_and_moderation.sql
--
-- WHAT THIS CHANGES
--   Phase 2 of `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`:
--   reporting and admin moderation (owner decisions 4 and 14 — report + block
--   everywhere, a 24-hour admin review SLA, and at launch exactly four admin
--   powers: suspend, unsuspend, remove content, dismiss a report).
--     1. `public.reports` — one row per report. RPC-only writes; the reporter
--        can read a narrow column set of their OWN reports; nobody else —
--        including the person reported — can read anything.
--     2. `public.moderation_actions` — an APPEND-ONLY log of every admin
--        action (BEFORE UPDATE / DELETE / TRUNCATE triggers raise).
--     3. `public.submit_report(uuid, text, text)` — rate-limited, standing-
--        gated, text-filtered.
--     4. Four admin RPCs, each re-checking `private.is_admin()` itself:
--        `admin_list_reports`, `admin_resolve_report`, `admin_suspend_user`,
--        `admin_unsuspend_user`.
--     5. One `app_config` row: `rate_limit_report_submit_per_user_day` (10).
--
--   Nothing in the live app calls any of these yet: the report sheet and the
--   reports queue exist only under the admin-gated `/MapTest` route
--   (amendment §9).
--
-- ===========================================================================
-- reports — SHAPE, AND WHAT IS DELIBERATELY NARROW FOR NOW
-- ===========================================================================
--   `subject_kind` admits only `'user'` today. LATER PHASES WILL WIDEN THIS
--   CHECK to add `'hangout'`, `'message'` and `'meetup_request'` (with a
--   matching nullable `subject_*_id` column each) once those tables exist —
--   the same "widen a CHECK together with its first caller" convention as
--   `blocks.source` (20261009130000) and `meetings.verification_method`
--   (20260926120000).
--
--   `category` is the seven-value closed set from the phase brief. `details`
--   is optional free text, at most 1000 characters (CHECK here, re-checked in
--   the RPC so the refusal is a reason rather than a constraint error), and
--   passed through `private.text_violation(..., 'report_details')`
--   (20261009150000 — read its header's flagged concern about filtering
--   report text before tuning the list).
--
--   `evidence_snapshot` is written by `submit_report`, never by a client: the
--   subject's display fields as they were AT THE MOMENT OF THE REPORT (name,
--   username, bio, company, role, photo path, account status) plus the
--   relationship basis (connection status, if any). Reported content is
--   usually edited or deleted once the person notices; the admin reviewing
--   it hours later needs what the reporter saw, not what is there now. It
--   holds nothing the reporter could not already see about that person
--   (phone and email are deliberately not captured).
--
--   `sla_due_at = created_at + 24 hours` — the amendment's review SLA, stored
--   per row so the queue can sort by it and so a later SLA change does not
--   rewrite existing reports' deadlines.
--
--   FK delete behaviour: every user reference is SET NULL. A report is an
--   audit record (20260809210100 convention 2) and must survive either
--   party's hard deletion — soft deletion, the only kind the app performs,
--   leaves it untouched anyway. Consequently "subject_kind = 'user' implies
--   subject_user_id is not null" is enforced in `submit_report`, not by a
--   CHECK: a CHECK would make the SET NULL cascade itself fail.
--
-- ===========================================================================
-- reports — WHO CAN READ WHAT (the brief left this to judgment; the call)
-- ===========================================================================
--   The reporter may read THEIR OWN reports, through a column-scoped grant:
--     id, subject_kind, subject_user_id, category, details, status,
--     created_at, resolved_at
--   i.e. what they submitted and whether it has been dealt with. NOT granted:
--     evidence_snapshot  — the admin's working copy of the subject's profile;
--     sla_due_at         — an internal staffing target, not a promise;
--     resolved_by        — which admin handled it (an inventory of who to
--                          pressure, the same reason `is_admin` is unreadable);
--     resolution_note    — written for the admin team, not the reporter;
--     reporter_user_id   — always the reader themself (the policy uses it;
--                          policy expressions are not column-permission
--                          checked, as `users.status` in the users policy
--                          already demonstrates).
--   No branch admits the SUBJECT, ever — a reported person learning who
--   reported them is the retaliation path report systems exist to close —
--   and no branch admits admins: admins read through `admin_list_reports`,
--   which re-checks `private.is_admin()`, so there is exactly one admin read
--   path to audit. Nothing in Phase 2 renders a reporter's own report list;
--   the grant exists so that "your report was received / dealt with" can be
--   built without another migration.
--
--   No INSERT, UPDATE or DELETE grant to any client role. `submit_report`
--   inserts; the admin RPCs update; nothing deletes.
--
-- ===========================================================================
-- submit_report — ORDER OF CHECKS, AND WHY
-- ===========================================================================
--   1. Caller from the JWT, must be `active`.
--   2. RATE LIMIT FIRST, via the existing mechanism: `public.rate_limit_consume`
--      (20260813210200), which records-then-counts so a refused attempt still
--      spends budget, keyed `('report_submit', 'user', <caller>)`, with the
--      ceiling read from `app_config` (missing row -> refuse, never a
--      default). Spent before anything about the subject is looked at, so the
--      budget cannot be used to probe uuids for free and the rate-limited
--      answer is identical whoever is named. This is the same in-function
--      consumption `claim_unassigned_card` and `event_attendee_profile` use,
--      and for their reason: an RPC granted to `authenticated` is reachable
--      without going through any TypeScript that could have consumed it.
--   3. Category and details validation — `invalid_category`,
--      `details_too_long`, `details_rejected` (content filter). All depend only
--      on the caller's own input.
--   4. STANDING. `private.has_safety_standing(caller, subject)`
--      (20261009130000): a connection row in any status, or the same event's
--      roster population. Without it -> `{ok:false, reason:'unavailable'}`,
--      identical for "not a real id", "a real person you have never crossed
--      paths with" and "yourself" — so this is not an existence oracle either.
--
--      WHY STANDING AND NOT "CAN SEE THEM RIGHT NOW". The brief allowed either
--      a visibility check or the narrower "existing connection" rule; standing
--      is chosen over both because (a) blocking someone removes the
--      connection and hides their profile, and "block, then report" is the
--      most common order a frightened person does those two things in — a
--      can-see-now check would refuse exactly that report; and (b) a
--      roster-only co-attendee who harassed someone at an event never had a
--      connection at all. Standing is history-based, so both work.
--
--      WHY A REFUSED REPORT SAYS SO, WHEN A REFUSED BLOCK DOES NOT.
--      `block_user` answers `{ok:true}` even when it wrote nothing, because a
--      block against nobody harms nobody. A report that silently vanishes is a
--      safety report nobody reads, so this answers `unavailable` and the UI
--      points to the safety page's contact route. The difference reveals only
--      whether the CALLER has crossed paths with the uuid they supplied —
--      something they already know — and is the same answer for a fake uuid
--      as for a stranger.
--
--      LATER PHASES WIDEN WHAT CAN BE REPORTED, NOT THIS RULE'S SPIRIT: a map
--      pin, a meetup request, a message thread and a hangout are each a new
--      "you crossed paths" relationship, and each phase that builds one adds
--      it (to standing, or as a new `subject_kind` with its own check).
--   5. Snapshot the subject, insert with `sla_due_at = now() + 24h`, return
--      `{ok:true}`. The report id is not returned — nothing needs it.
--
-- ===========================================================================
-- moderation_actions — APPEND-ONLY, AND WHAT THAT COSTS
-- ===========================================================================
--   Every suspend, unsuspend and dismissal writes one row, in the same
--   transaction as the change it records. BEFORE UPDATE, BEFORE DELETE and
--   BEFORE TRUNCATE triggers raise for EVERY role, the service role and the
--   table owner included — RLS can be bypassed by `service_role`; a trigger
--   cannot (short of `session_replication_role = replica`, which is a
--   deliberate, superuser-level act). The point of an action log is that the
--   people whose actions it records cannot quietly edit it.
--
--   THE COST, STATED: because rows can never be updated, foreign keys to
--   `users` and `reports` are ON DELETE RESTRICT, not SET NULL (a SET NULL
--   cascade is an UPDATE, which the trigger would refuse anyway). So a HARD
--   delete of a user who appears in this log — as the admin or the target —
--   or of a report it references is refused until a human decides what to do
--   with the log. That matches 20260809210100's rule ("RESTRICT for rows that
--   are shared history ... a human should be forced to decide first"). Soft
--   deletion is unaffected. The same retention-vs-deletion question the
--   amendment's §12 raises for the future private admin log applies here and
--   is flagged there, not decided here.
--
--   `action` is the narrow Phase 2 set: `suspend_user`, `unsuspend_user`,
--   `dismiss_report`. `remove_hangout` / `remove_message` are added by the
--   phases that build those tables (widen-together, as above). No permanent
--   ban or warning action exists yet (owner decision 14).
--
-- ===========================================================================
-- THE ADMIN RPCs
-- ===========================================================================
--   Every one re-checks `private.is_admin()` (active admins only — a
--   suspended admin is not an admin, 20260827120000) and fails closed,
--   mirroring 20260830120000 / `decide_host_application` exactly:
--     * the list returns `[]` to a non-admin, never an error;
--     * the three mutations RAISE 42501 'not authorized' for a non-admin AND
--       for an unknown report id, identically, so they cannot be used to
--       probe which report ids exist.
--   Once a caller is an admin, state refusals come back as
--   `{ok:false, reason}` — an admin is entitled to know why.
--
--   HOW "ACTIONED" IS REPRESENTED (the brief left this to judgment):
--     * The only enforcement action that exists in Phase 2 is a suspension.
--       So "actioned" always rests on one: `admin_suspend_user(target,
--       report_id, note)` suspends the account, logs `suspend_user` with that
--       report id, and marks the report `actioned` — one call, one
--       transaction.
--     * `admin_resolve_report(id, 'actioned', note)` exists for closing
--       FURTHER reports about someone already suspended (three people report
--       the same person; the admin suspends from one report and closes the
--       other two). It is accepted only while the subject is currently
--       `suspended` AND a `suspend_user` row exists for them; otherwise it
--       refuses with `no_enforcement_action`. "Actioned" can therefore never
--       be a bare label with no action behind it. It writes no new
--       `moderation_actions` row — the suspension it rests on is already in
--       the log, and the closing admin, time and note are recorded on the
--       report row itself.
--     * `admin_resolve_report(id, 'dismissed', note)` logs `dismiss_report`
--       and marks the report dismissed.
--     * A report can be resolved exactly once (`already_resolved` after
--       that). The resolution fields are only written by these RPCs.
--
--   admin_suspend_user / admin_unsuspend_user — A SECOND WRITER OF users.status
--     Until now the only in-app writer of `users.status` was
--     `soft_delete_own_account()` (plus the service-role-only
--     `restore_deleted_user` and `claim_placeholder_user`). These two are a
--     second in-app writer, serving a structurally different caller: an ADMIN
--     acting on another account, versus a member acting on their own.
--     `packages/core/src/connect/__tests__/no-second-write-path.test.ts` is
--     updated in the same change to say so and to assert each RPC's single
--     caller. The transitions are deliberately narrow:
--       suspend:   'active'    -> 'suspended' only (refuses deleted,
--                  placeholder and already-suspended accounts — suspending a
--                  placeholder would also break claim_placeholder_user's
--                  `status = 'placeholder'` lookup); refuses the caller's own
--                  account (an admin suspending themself would lose the power
--                  to undo it, since a suspended admin is not an admin).
--       unsuspend: 'suspended' -> 'active' only — never deleted -> active,
--                  which would be `restore_deleted_user`'s job and is
--                  service-role only on purpose.
--     What a suspension does: `ensureUser()` refuses to mint a session for any
--     non-active account, so the person is signed out of everything on their
--     next request (tokens live five minutes). Their profile stays readable to
--     their connections, exactly as 20260815130200 decided for `suspended`.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants:
--     * SELECT on `reports` (id, subject_kind, subject_user_id, category,
--       details, status, created_at, resolved_at) to `authenticated`,
--       filtered by policy to rows where the caller is the reporter.
--     * EXECUTE to `authenticated` on `submit_report`, `admin_list_reports`,
--       `admin_resolve_report`, `admin_suspend_user`, `admin_unsuspend_user`.
--       The four admin RPCs do nothing (list: `[]`; mutations: 42501) unless
--       `private.is_admin()` is true for the caller at call time.
--   Forbids:
--     * Every other column of `reports`, every row of it the caller did not
--       submit, and every write to it, to every client role. The subject of a
--       report can read nothing about it.
--     * Every privilege on `moderation_actions` to every client role; UPDATE,
--       DELETE and TRUNCATE on it to EVERY role, by trigger.
--     * Any client write to `users.status` — still absent from the column
--       UPDATE grant; the admin RPCs are the only new path, and only for an
--       active admin.
--   `anon` gets nothing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. app_config — the report budget
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value, description) values
  ('rate_limit_report_submit_per_user_day', '10'::jsonb,
   'How many reports one account may submit per day (20261009150100). High enough that someone being harassed by several people is never stopped from reporting all of them; low enough that one account cannot flood the admin queue. Budget is spent per attempt, refused or not.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. reports
-- ---------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references public.users(id) on delete set null,
  subject_kind text not null
    check (subject_kind in ('user')),
  subject_user_id uuid references public.users(id) on delete set null,
  category text not null
    check (category in (
      'harassment', 'inappropriate_content', 'spam', 'safety_concern',
      'underage', 'impersonation', 'other'
    )),
  details text
    check (details is null or char_length(details) <= 1000),
  evidence_snapshot jsonb,
  status text not null default 'open'
    check (status in ('open', 'actioned', 'dismissed')),
  sla_due_at timestamptz not null,
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  resolution_note text
    check (resolution_note is null or char_length(resolution_note) <= 1000),
  created_at timestamptz not null default now(),

  -- An open report has no resolution; a resolved one has a resolution time.
  -- (resolved_by may later be nulled by an admin's hard deletion, so it is
  -- not part of the check.)
  constraint reports_resolution_is_complete check (
    (status = 'open' and resolved_at is null and resolved_by is null and resolution_note is null)
    or (status <> 'open' and resolved_at is not null)
  )
);

comment on table public.reports is
  'User reports (20261009150100). Written only by submit_report and the admin '
  'RPCs. A reporter may read a narrow column set of their own reports; the '
  'subject can read nothing; admins read through admin_list_reports only. '
  'subject_kind is ''user'' only for now — later phases widen it.';

comment on column public.reports.evidence_snapshot is
  'What the subject''s profile looked like when reported, captured by '
  'submit_report so later edits cannot erase the evidence. Admin-only.';

comment on column public.reports.sla_due_at is
  'created_at + 24 hours — the amendment''s review SLA. Internal; not in the '
  'reporter''s column grant.';

create index reports_open_queue_idx on public.reports (status, sla_due_at);
create index reports_reporter_user_id_idx on public.reports (reporter_user_id);
create index reports_subject_user_id_idx on public.reports (subject_user_id);
create index reports_resolved_by_idx on public.reports (resolved_by);

alter table public.reports enable row level security;
alter table public.reports force row level security;
revoke all on public.reports from public, anon, authenticated;

grant select (
  id, subject_kind, subject_user_id, category, details, status, created_at, resolved_at
) on public.reports to authenticated;

create policy "reporters may read their own reports"
  on public.reports
  for select
  to authenticated
  using (reporter_user_id = (select private.current_user_id()));

-- ---------------------------------------------------------------------------
-- 2. moderation_actions — append-only
-- ---------------------------------------------------------------------------
create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT, not SET NULL — see the header ("WHAT THAT COSTS").
  admin_user_id uuid not null references public.users(id) on delete restrict,
  action text not null
    check (action in ('suspend_user', 'unsuspend_user', 'dismiss_report')),
  target_user_id uuid references public.users(id) on delete restrict,
  report_id uuid references public.reports(id) on delete restrict,
  note text
    check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);

comment on table public.moderation_actions is
  'Append-only log of every admin moderation action (20261009150100). UPDATE, '
  'DELETE and TRUNCATE raise for every role, service role and owner '
  'included. Foreign keys RESTRICT, so a hard delete of anyone or anything it '
  'references is refused until a human decides. No client privilege at all.';

create index moderation_actions_admin_user_id_idx on public.moderation_actions (admin_user_id);
create index moderation_actions_target_user_id_idx on public.moderation_actions (target_user_id);
create index moderation_actions_report_id_idx on public.moderation_actions (report_id);

alter table public.moderation_actions enable row level security;
alter table public.moderation_actions force row level security;
revoke all on public.moderation_actions from public, anon, authenticated;

create or replace function private.tg_refuse_append_only_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is not permitted', tg_table_name, tg_op
    using errcode = '55000';
end;
$$;

comment on function private.tg_refuse_append_only_change() is
  'Trigger body that refuses UPDATE/DELETE/TRUNCATE on an append-only table '
  '(first used by moderation_actions, 20261009150100). Applies to every role.';

revoke all on function private.tg_refuse_append_only_change() from public, anon, authenticated;

create trigger moderation_actions_no_update
  before update on public.moderation_actions
  for each row execute function private.tg_refuse_append_only_change();

create trigger moderation_actions_no_delete
  before delete on public.moderation_actions
  for each row execute function private.tg_refuse_append_only_change();

create trigger moderation_actions_no_truncate
  before truncate on public.moderation_actions
  for each statement execute function private.tg_refuse_append_only_change();

-- ---------------------------------------------------------------------------
-- 3. public.submit_report
-- ---------------------------------------------------------------------------
create or replace function public.submit_report(
  p_subject_user_id uuid,
  p_category text,
  p_details text default null
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
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_subject public.users%rowtype;
  v_connection_status text;
begin
  if v_user is null
     or not exists (select 1 from public.users u where u.id = v_user and u.status = 'active') then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- 2. Budget first (header). Missing config -> refuse, never a default.
  select (a.value #>> '{}')::integer into v_limit
    from public.app_config a where a.key = 'rate_limit_report_submit_per_user_day';

  if v_limit is null then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;

  if not public.rate_limit_consume('report_submit', 'user', v_user::text, v_limit, 86400) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- 3. The caller's own input.
  if p_category is null or p_category not in (
       'harassment', 'inappropriate_content', 'spam', 'safety_concern',
       'underage', 'impersonation', 'other') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_category');
  end if;

  if v_details is not null and char_length(v_details) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'details_too_long');
  end if;

  if private.text_violation(v_details, 'report_details') then
    return jsonb_build_object('ok', false, 'reason', 'details_rejected');
  end if;

  -- 4. Standing — identical refusal for fake, stranger and self.
  if not private.has_safety_standing(v_user, p_subject_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;

  -- 5. Snapshot and insert.
  select * into v_subject from public.users u where u.id = p_subject_user_id;

  select c.status into v_connection_status
    from public.connections c
   where c.user_a_id = least(v_user, p_subject_user_id)
     and c.user_b_id = greatest(v_user, p_subject_user_id);

  insert into public.reports (
    reporter_user_id, subject_kind, subject_user_id, category, details,
    evidence_snapshot, sla_due_at
  ) values (
    v_user, 'user', p_subject_user_id, p_category, v_details,
    jsonb_build_object(
      'captured_at', now(),
      'subject', jsonb_build_object(
        'first_name', v_subject.first_name,
        'last_name', v_subject.last_name,
        'username', v_subject.username,
        'bio', v_subject.bio,
        'company_name', v_subject.company_name,
        'company_role', v_subject.company_role,
        'photo_path', v_subject.photo_path,
        'status', v_subject.status
      ),
      'relationship', jsonb_build_object(
        'connection_status', v_connection_status
      )
    ),
    now() + interval '24 hours'
  );

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.submit_report(uuid, text, text) is
  'Files a report about a person the caller has crossed paths with '
  '(private.has_safety_standing). Rate-limited per caller per day via '
  'rate_limit_consume (budget spent first), details content-filtered via '
  'private.text_violation, subject snapshotted as evidence, SLA due in 24h. '
  'Returns {ok:true} or {ok:false, reason}; "unavailable" is identical for a '
  'fake id, a stranger and the caller themself (20261009150100).';

revoke all on function public.submit_report(uuid, text, text) from public, anon;
grant execute on function public.submit_report(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4a. public.admin_list_reports
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  -- Fail closed to nothing, exactly like admin_list_host_applications.
  if not private.is_admin() then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(t.row_data order by t.is_closed, t.sla_due_at, t.created_at), '[]'::jsonb)
    into v_rows
  from (
    select
      r.status <> 'open' as is_closed,
      r.sla_due_at,
      r.created_at,
      jsonb_build_object(
        'id', r.id,
        'status', r.status,
        'subject_kind', r.subject_kind,
        'category', r.category,
        'details', r.details,
        'evidence_snapshot', r.evidence_snapshot,
        'sla_due_at', r.sla_due_at,
        'created_at', r.created_at,
        'resolved_at', r.resolved_at,
        'resolution_note', r.resolution_note,
        'subject', case when s.id is null then null else jsonb_build_object(
          'id', s.id,
          'first_name', s.first_name,
          'last_name', s.last_name,
          'photo_path', s.photo_path,
          'status', s.status
        ) end,
        'reporter', case when rep.id is null then null else jsonb_build_object(
          'id', rep.id,
          'first_name', rep.first_name,
          'last_name', rep.last_name
        ) end
      ) as row_data
    from public.reports r
    left join public.users s on s.id = r.subject_user_id
    left join public.users rep on rep.id = r.reporter_user_id
    -- Open reports first, by deadline; then the most recent closed ones. The
    -- cap keeps one call bounded; at this product's scale it is never hit by
    -- open reports, and closed history beyond it is a later admin-UI concern.
    order by (r.status <> 'open'), r.sla_due_at, r.created_at
    limit 500
  ) t;

  return v_rows;
end;
$$;

comment on function public.admin_list_reports() is
  'The reports queue for active admins: open reports first, by sla_due_at '
  'ascending, then closed ones; each with the evidence snapshot, the '
  'subject''s current name/photo path/status and the reporter''s name. '
  'Returns [] to anyone who is not an active admin (20261009150100).';

revoke all on function public.admin_list_reports() from public, anon;
grant execute on function public.admin_list_reports() to authenticated;

-- ---------------------------------------------------------------------------
-- 4b. public.admin_resolve_report
-- ---------------------------------------------------------------------------
create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.current_user_id();
  v_report public.reports%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not private.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_decision is null or p_decision not in ('actioned', 'dismissed') then
    raise exception 'decision must be actioned or dismissed' using errcode = '22023';
  end if;

  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'note is too long' using errcode = '22023';
  end if;

  select * into v_report from public.reports r where r.id = p_report_id for update;
  if v_report.id is null then
    -- Same message as a non-admin, so report ids cannot be probed.
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_report.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'already_resolved');
  end if;

  if p_decision = 'dismissed' then
    insert into public.moderation_actions (admin_user_id, action, target_user_id, report_id, note)
    values (v_admin, 'dismiss_report', v_report.subject_user_id, v_report.id, v_note);
  else
    -- "Actioned" must rest on a real enforcement action — see the header.
    if not exists (
         select 1 from public.users u
          where u.id = v_report.subject_user_id and u.status = 'suspended')
       or not exists (
         select 1 from public.moderation_actions m
          where m.target_user_id = v_report.subject_user_id and m.action = 'suspend_user') then
      return jsonb_build_object('ok', false, 'reason', 'no_enforcement_action');
    end if;
  end if;

  update public.reports r
     set status = p_decision,
         resolved_at = now(),
         resolved_by = v_admin,
         resolution_note = v_note
   where r.id = v_report.id;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.admin_resolve_report(uuid, text, text) is
  'Closes an open report as dismissed (logs dismiss_report) or actioned '
  '(only while the subject is suspended and a suspend_user action exists for '
  'them — "actioned" is never a bare label). Active admins only; a non-admin '
  'and an unknown report id both raise 42501 identically (20261009150100).';

revoke all on function public.admin_resolve_report(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_report(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4c. public.admin_suspend_user
-- ---------------------------------------------------------------------------
create or replace function public.admin_suspend_user(
  p_target_user_id uuid,
  p_report_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.current_user_id();
  v_status text;
  v_report public.reports%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not private.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'note is too long' using errcode = '22023';
  end if;

  if p_target_user_id is null or p_target_user_id = v_admin then
    return jsonb_build_object('ok', false, 'reason', 'invalid_target');
  end if;

  -- Lock order: the user row, then the report row. admin_resolve_report locks
  -- only the report, and admin_unsuspend_user only the user, so no two of
  -- these can deadlock on each other.
  select u.status into v_status from public.users u where u.id = p_target_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'not_active', 'status', v_status);
  end if;

  if p_report_id is not null then
    select * into v_report from public.reports r where r.id = p_report_id for update;
    if v_report.id is null then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    if v_report.status <> 'open' or v_report.subject_user_id is distinct from p_target_user_id then
      return jsonb_build_object('ok', false, 'reason', 'report_mismatch');
    end if;
  end if;

  update public.users u
     set status = 'suspended'
   where u.id = p_target_user_id;

  insert into public.moderation_actions (admin_user_id, action, target_user_id, report_id, note)
  values (v_admin, 'suspend_user', p_target_user_id, p_report_id, v_note);

  if p_report_id is not null then
    update public.reports r
       set status = 'actioned',
           resolved_at = now(),
           resolved_by = v_admin,
           resolution_note = v_note
     where r.id = p_report_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.admin_suspend_user(uuid, uuid, text) is
  'Suspends an ACTIVE account (active -> suspended only; never yourself), logs '
  'suspend_user, and — if a report id is given — marks that open report about '
  'this person actioned, all in one transaction. A second in-app writer of '
  'users.status alongside soft_delete_own_account, for a different caller (an '
  'admin, about someone else). Active admins only (20261009150100).';

revoke all on function public.admin_suspend_user(uuid, uuid, text) from public, anon;
grant execute on function public.admin_suspend_user(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4d. public.admin_unsuspend_user
-- ---------------------------------------------------------------------------
create or replace function public.admin_unsuspend_user(
  p_target_user_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.current_user_id();
  v_status text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not private.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'note is too long' using errcode = '22023';
  end if;

  select u.status into v_status from public.users u where u.id = p_target_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- suspended -> active ONLY. A deleted account is restore_deleted_user's job
  -- (service role); a placeholder is claim_placeholder_user's.
  if v_status <> 'suspended' then
    return jsonb_build_object('ok', false, 'reason', 'not_suspended', 'status', v_status);
  end if;

  update public.users u
     set status = 'active'
   where u.id = p_target_user_id;

  insert into public.moderation_actions (admin_user_id, action, target_user_id, report_id, note)
  values (v_admin, 'unsuspend_user', p_target_user_id, null, v_note);

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.admin_unsuspend_user(uuid, text) is
  'Lifts a suspension (suspended -> active only) and logs unsuspend_user. '
  'Active admins only (20261009150100).';

revoke all on function public.admin_unsuspend_user(uuid, text) from public, anon;
grant execute on function public.admin_unsuspend_user(uuid, text) to authenticated;
