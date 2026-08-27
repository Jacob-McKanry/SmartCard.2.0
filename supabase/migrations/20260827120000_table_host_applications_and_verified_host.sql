-- =============================================================================
-- 20260827120000_table_host_applications_and_verified_host.sql
--
-- APPLIED to project `crpsbnbegeoqtlgshltt` on 2026-08-27 and verified live:
--   0 applications, 0 verified hosts, 341 users unchanged, and zero client
--   grants of any kind on `users.is_verified_host` (neither SELECT nor UPDATE)
--   or on `host_applications` (neither INSERT, UPDATE nor DELETE).
--   `get_advisors(security)` returns no new CLASS of finding: INFO count
--   unchanged at five, and the three new WARNs are
--   `authenticated_security_definer_function_executable` for the three RPCs
--   below — the intended posture, joining eight pre-existing identical entries
--   for the RSVP RPCs, `claim_unassigned_card` and `soft_delete_own_account`.
--   `private.is_admin()` correctly does not appear, being unexposed.
--   The migration record's `version` was corrected to match this filename;
--   Supabase had recorded its own apply-time timestamp instead.
--
-- WHAT THIS CHANGES
--   Adds `public.users.is_verified_host`, `public.host_applications`,
--   `private.is_admin()`, and three RPCs — `public.submit_host_application`,
--   `public.decide_host_application` and `public.is_verified_host`.
--
--   Nothing else changes. No existing policy, grant or function is altered.
--   Every existing account keeps `is_verified_host = false`, so this migration
--   grants nobody anything on its own — it only creates the gate that a later
--   migration's CSV import will stand behind.
--
-- WHY THIS EXISTS
--   `docs/architecture/2026-08-27-event-attendee-import.md` §9. The CSV import
--   lets a host mail every address in a spreadsheet from our domain. Without a
--   gate, anyone who can create an event can do that — create a throwaway
--   event, upload a purchased list, and the mail looks legitimate because it
--   genuinely comes from `smartcard.tech`. The import's other controls (§3's
--   claim gate, §2.3.1's approval filter) all protect the *people on the list*;
--   none of them stop the list existing in the first place. This one does.
--
--   It raises the cost of abuse from "click a button" to "convince a human
--   once", which is the same level of friction every other control in this
--   product is calibrated to. It is a floor, not a guarantee: a verified host
--   acting in bad faith on a real list is a different problem, addressed by
--   §2.3.1's status filter and by revocation, not by this gate.
--
-- ===========================================================================
-- WHY `is_verified_host` IS A COLUMN ON `users` AND NOT A ROLE OR A TABLE
-- ===========================================================================
--   Because `is_admin` already established the pattern, and this is the same
--   kind of thing: a flat, account-level privilege that no client may assert
--   about itself. 20260809211100 protects `is_admin` by leaving it out of the
--   column-scoped UPDATE grant — "a self-update would be privilege escalation"
--   — rather than by writing a policy, because as 20260813210100 notes, "RLS
--   cannot express 'this row but not this column'". `is_verified_host` is
--   added the same way: absent from that grant, so a client cannot set it
--   through PostgREST, through the app, or through any route that does not go
--   through `decide_host_application` below.
--
--   The owner's decision (2026-08-27) is that approval is account-level, not
--   per-event: once verified, a host may import to any event they run. A
--   per-event approval table would have been the alternative and was rejected
--   because it makes admin work scale with event count, which does not survive
--   more than a handful of hosts.
--
-- ===========================================================================
-- WHY WRITES GO THROUGH RPCs AND READS GO THROUGH RLS
-- ===========================================================================
--   The read side is ordinary: an applicant may read their own application, an
--   admin may read all of them. A policy expresses that exactly.
--
--   The write side is not ordinary, because the client must not choose
--   `status`. A column-scoped INSERT grant would work for that, but two things
--   push this to an RPC instead. First, re-application has to REPLACE a
--   previous decision atomically — clearing `decided_at`, `decided_by_user_id`
--   and `rejection_note` in the same statement that resets `status` to
--   `pending`, or a rejected applicant briefly reads as approved-with-a-note.
--   Second, and the deciding reason, it is the distinction
--   `20260821120000` draws: the caller supplies evidence to be weighed, and the
--   DATABASE records the conclusion. An application is exactly that shape. The
--   client says what its organization is; the database says the status is
--   `pending` and nothing else, ever.
--
-- ===========================================================================
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
-- ===========================================================================
--   Grants:
--     - SELECT on `public.host_applications` to `authenticated`, filtered by
--       policy to the caller's own row plus, for an active admin, every row.
--     - EXECUTE on `public.submit_host_application`,
--       `public.decide_host_application` and `public.is_verified_host` to
--       `authenticated`. `decide_` refuses every non-admin caller internally,
--       and `is_verified_host()` takes no argument so it can only ever answer
--       about the caller.
--     - EXECUTE on `private.is_admin()` to `authenticated`, required because a
--       policy expression re-checks function EXECUTE as the CALLER
--       (20260809211400's finding — policies cover tables referenced in them,
--       not functions).
--   Forbids:
--     - INSERT, UPDATE and DELETE on `public.host_applications` to every
--       client role. There is no grant at all; the RPCs are the only writers.
--     - Any client write to `users.is_verified_host`. It is deliberately
--       absent from the 20260809211100 UPDATE grant and no statement here adds
--       it. It is equally absent from the 20260814230000 SELECT grant, so a
--       client cannot READ the flag off a `users` row either — its own or
--       anyone else's. `public.is_verified_host()` is the only reader, and it
--       only ever answers about the caller.
--     - Reading another person's application, unless the caller is an ACTIVE
--       admin. A suspended admin is not an admin (see `private.is_admin`).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users.is_verified_host
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists is_verified_host boolean not null default false;

comment on column public.users.is_verified_host is
  'Whether this account may upload an attendee CSV to events it hosts (§9 of '
  'the 2026-08-27 attendee-import design). Account-level, not per-event: one '
  'approval covers every event the host runs. Deliberately excluded from the '
  'column-scoped UPDATE grant in 20260809211100, exactly as `is_admin` is, so '
  'no client can grant it to itself; the only writer is '
  'public.decide_host_application. Default false means this migration hands '
  'nobody anything.';

-- ---------------------------------------------------------------------------
-- public.is_verified_host — how the app asks about ITS OWN flag
-- ---------------------------------------------------------------------------
-- Found while verifying this migration against the live database, not by
-- reading the schema: adding the column does NOT make it readable. The
-- column-scoped SELECT grant in 20260814230000 lists eleven columns by name,
-- and a column absent from it raises 42501 for `authenticated` — so the host's
-- own screen could not have asked "may I import?" at all. The verification run
-- failed on exactly that, which is the grant working as designed.
--
-- Two ways to fix it, and the narrower one is chosen. Adding the column to the
-- SELECT grant would work, but that grant is filtered by the `users` read
-- policy — self, connections, and co-attendees — so it would also tell your
-- connections and everyone at your events whether you are a verified host.
-- Nothing needs that. This RPC answers only about the caller, so the fact
-- stays exactly as private as it was before the column existed.
create or replace function public.is_verified_host()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select u.is_verified_host
      from public.users u
      where u.id = private.current_user_id()
        and u.status = 'active'
    ),
    false
  );
$$;

comment on function public.is_verified_host() is
  'Whether the CALLER may upload an attendee CSV. Self-only by construction — '
  'it takes no argument, so there is no version of this that answers about '
  'somebody else. Exists because users.is_verified_host is deliberately absent '
  'from the 20260814230000 SELECT grant: widening that grant would disclose '
  'the flag to connections and co-attendees, who have no need for it.';

revoke all on function public.is_verified_host() from public, anon;
grant execute on function public.is_verified_host() to authenticated;

-- ---------------------------------------------------------------------------
-- private.is_admin
-- ---------------------------------------------------------------------------
-- `users.is_admin` has existed since 20260809210100 and has never been READ by
-- anything — it appears in this codebase only as a column every grant excludes.
-- This is the first thing that consults it, so the helper is new.
--
-- `status = 'active'` is part of the check on purpose. A suspended or deleted
-- account must not retain admin powers; 20260815130200 already established
-- that `deleted` hides a user everywhere, and an admin whose access was
-- withdrawn is precisely the caller this function must refuse.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select u.is_admin
      from public.users u
      where u.id = private.current_user_id()
        and u.status = 'active'
    ),
    false
  );
$$;

comment on function private.is_admin() is
  'True when the authenticated caller is an ACTIVE admin. Returns false for no '
  'JWT, an unknown user, or a suspended/deleted account — fail-closed like '
  'every other §3.1 helper. First consumer of users.is_admin, which until now '
  'was written by nobody and read by nothing.';

revoke all on function private.is_admin() from public, anon;
-- Required for policy expressions: a policy re-checks function EXECUTE as the
-- caller, not as the table owner (20260809211400).
grant execute on function private.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- public.host_applications
-- ---------------------------------------------------------------------------
create table if not exists public.host_applications (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: an application is a fact about this person and is meaningless
  -- once the account is gone. Matches `event_invites.invited_user_id`.
  user_id uuid not null references public.users(id) on delete cascade,

  -- The four things the owner chose to ask for (2026-08-27). Deliberately not
  -- asked: government ID, business registration, or anything that would make
  -- this form a bigger data-collection liability than the abuse it prevents.
  organization_name text not null,
  applicant_role text not null,
  past_event_link text not null,
  expected_event_size text,
  hosting_frequency text,

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),

  submitted_at timestamptz not null default now(),
  decided_at timestamptz,

  -- SET NULL, not cascade: this is attribution of a decision, not a fact about
  -- the admin. Same reasoning as `event_invites.invited_by_user_id`.
  decided_by_user_id uuid references public.users(id) on delete set null,

  -- Shown to the applicant, so it is written for a person to read. Never a
  -- place for internal suspicion — see decide_host_application's comment.
  rejection_note text,

  -- One live application per account. Re-applying REPLACES the previous one
  -- rather than stacking a history an admin has to page through, which is what
  -- makes submit_host_application an upsert.
  constraint host_applications_one_per_user unique (user_id),

  -- A decided application has a decision timestamp and a decider; a pending
  -- one has neither. Keeps "approved by nobody at no time" out of the table
  -- even if a future writer forgets.
  constraint host_applications_decision_is_complete check (
    (status = 'pending' and decided_at is null)
    or (status <> 'pending' and decided_at is not null)
  )
);

comment on table public.host_applications is
  'Applications to become a verified host, per §9 of the 2026-08-27 '
  'attendee-import design. One row per account (re-applying replaces). '
  'Readable by the applicant and by active admins; written only by '
  'submit_host_application and decide_host_application — there is no INSERT, '
  'UPDATE or DELETE grant to any client role.';

comment on column public.host_applications.rejection_note is
  'Optional reason shown TO THE APPLICANT. Write it as a sentence a person can '
  'act on ("we could not verify a past event — reapply with a link"), never a '
  'copy of internal suspicion, because the applicant reads it verbatim.';

alter table public.host_applications enable row level security;
alter table public.host_applications force row level security;

-- Read only. Every write path is an RPC below.
grant select on public.host_applications to authenticated;

create policy "read your own application, or every application if admin"
  on public.host_applications
  for select
  to authenticated
  using (
    user_id = private.current_user_id()
    or private.is_admin()
  );

-- ---------------------------------------------------------------------------
-- submit_host_application
-- ---------------------------------------------------------------------------
-- Upsert, because `host_applications_one_per_user` means a re-application is
-- an update to the existing row. Every field the previous decision left behind
-- is cleared in the same statement, so a rejected applicant who reapplies is
-- `pending` with no stale note, not `pending` still carrying the old reason.
--
-- `security definer` for one reason only: to force `status`. The caller has no
-- write grant on this table at all, so there is no path by which a client can
-- choose its own status, set `decided_by_user_id`, or resurrect a note.
create or replace function public.submit_host_application(
  p_organization_name text,
  p_applicant_role text,
  p_past_event_link text,
  p_expected_event_size text default null,
  p_hosting_frequency text default null
)
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
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- An application from a suspended or deleted account is refused rather than
  -- silently queued for an admin who would then be approving a dead account.
  if not exists (
    select 1 from public.users u where u.id = v_user and u.status = 'active'
  ) then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if coalesce(btrim(p_organization_name), '') = ''
     or coalesce(btrim(p_applicant_role), '') = ''
     or coalesce(btrim(p_past_event_link), '') = '' then
    raise exception 'organization, role and a past event link are all required'
      using errcode = '22023';
  end if;

  insert into public.host_applications (
    user_id, organization_name, applicant_role, past_event_link,
    expected_event_size, hosting_frequency
  )
  values (
    v_user, btrim(p_organization_name), btrim(p_applicant_role),
    btrim(p_past_event_link),
    nullif(btrim(coalesce(p_expected_event_size, '')), ''),
    nullif(btrim(coalesce(p_hosting_frequency, '')), '')
  )
  on conflict (user_id) do update set
    organization_name   = excluded.organization_name,
    applicant_role      = excluded.applicant_role,
    past_event_link     = excluded.past_event_link,
    expected_event_size = excluded.expected_event_size,
    hosting_frequency   = excluded.hosting_frequency,
    status              = 'pending',
    submitted_at        = now(),
    decided_at          = null,
    decided_by_user_id  = null,
    rejection_note      = null;
end;
$$;

comment on function public.submit_host_application(text, text, text, text, text) is
  'Submits or replaces the caller''s own host application, always as `pending`. '
  'security definer purely to force that status and to clear any previous '
  'decision atomically — the caller holds no write grant on the table, so this '
  'is the only way a row gets there.';

revoke all on function public.submit_host_application(text, text, text, text, text) from public, anon;
grant execute on function public.submit_host_application(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- decide_host_application
-- ---------------------------------------------------------------------------
-- Admin-only, and the ONLY writer of `users.is_verified_host` anywhere.
--
-- Deliberately re-decidable: calling it with `p_approve => false` on an already
-- approved application is how verification gets REVOKED, which §9.4 requires
-- ("revoke the host status entirely if someone abuses it") and which needs no
-- second function to express.
--
-- The two writes — the application row and the user's flag — are one statement
-- apart inside one function, so they are one transaction. A partial outcome
-- (application says approved, flag says false) is the failure mode that would
-- make the queue lie to the admin about what they had already done.
create or replace function public.decide_host_application(
  p_application_id uuid,
  p_approve boolean,
  p_rejection_note text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.current_user_id();
  v_applicant uuid;
begin
  if not private.is_admin() then
    -- Same message an unauthenticated caller gets. An admin-only endpoint that
    -- says "you are not an admin" confirms the endpoint exists and is worth
    -- probing; one that refuses identically to everything else does not.
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select ha.user_id into v_applicant
  from public.host_applications ha
  where ha.id = p_application_id;

  if v_applicant is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.host_applications
     set status             = case when p_approve then 'approved' else 'rejected' end,
         decided_at         = now(),
         decided_by_user_id = v_admin,
         -- A note is only meaningful on a rejection; approving clears any note
         -- left over from a previous rejection of the same application.
         rejection_note     = case
                                when p_approve then null
                                else nullif(btrim(coalesce(p_rejection_note, '')), '')
                              end
   where id = p_application_id;

  update public.users
     set is_verified_host = p_approve
   where id = v_applicant;
end;
$$;

comment on function public.decide_host_application(uuid, boolean, text) is
  'Approves or rejects a host application and sets users.is_verified_host to '
  'match, in one transaction. Active admins only; refuses everyone else with '
  'the same message an unknown application id gets, so it cannot be used to '
  'probe which ids exist. Calling it with p_approve => false on an approved '
  'application is how verification is revoked (§9.4) — no separate function.';

revoke all on function public.decide_host_application(uuid, boolean, text) from public, anon;
grant execute on function public.decide_host_application(uuid, boolean, text) to authenticated;
