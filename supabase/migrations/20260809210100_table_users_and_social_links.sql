-- =============================================================================
-- 20260809210100_table_users_and_social_links.sql
--
-- WHAT THIS CHANGES
--   Creates `public.users` and `public.social_links` exactly as specified in
--   docs/architecture/2026-08-09-initial-architecture-proposal.md §2.1.
--   RLS is enabled and policies are added later (20260809211000 onwards), so
--   between this migration and that one these tables are unreachable by any
--   client role — the default privileges revoked in 20260809210000 see to that.
--
-- WHY
--   `users` is the anchor of the whole graph: every other table's access rules
--   are ultimately expressed as "what is this row's relationship to a row in
--   `users`". It is created first so the rest of the schema can reference it.
--
-- TWO CONVENTIONS ESTABLISHED HERE AND APPLIED THROUGHOUT THE SCHEMA
--
--   1. NULLABILITY. The architecture doc gives column types, not nullability,
--      for most tables. The rule used across every migration in this set is:
--      a column is NOT NULL when the row is meaningless or unsafe without it,
--      and nullable otherwise. Guessing "everything required" would block the
--      later data migration of 337 real users with patchy legacy profile data;
--      guessing "everything optional" would let the verification service write
--      a meeting with no timestamp. Where the call was genuinely close it is
--      called out in a comment on the column.
--
--   2. FOREIGN KEY DELETE BEHAVIOUR. Users are *soft* deleted here
--      (`status = 'deleted'`); a hard `delete from users` is an administrative
--      act, not something the app does. The delete rules therefore encode what
--      should happen if someone performs that act deliberately:
--        - CASCADE for rows that are purely that person's own data or their own
--          edges, and are meaningless once they are gone (social links, graph
--          edges, RSVPs, their own verification sessions).
--        - RESTRICT for rows that are shared history or physical inventory,
--          where silent destruction would be the wrong outcome and a human
--          should be forced to decide first (cards, hosted events).
--        - SET NULL for audit and cross-references, where the record must
--          survive the person (`connection_attempts`, `app_config.updated_by`).
--      Audit rows outliving their subject is the point of an audit log (§4.4).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create table public.users (
  -- UUID, never a sequential integer. §2 states the convention and §4.7 threat
  -- 5 the reason: a sequential id makes "try id + 1" a working enumeration
  -- attack against every endpoint that takes a user id, on top of RLS.
  id uuid primary key default gen_random_uuid(),

  -- The sole link to Kinde (§5.3). Every authenticated request resolves to a
  -- row through this column, so it is both NOT NULL and UNIQUE: a duplicate
  -- would mean one Kinde identity resolving to two SmartCard people, and a
  -- null would mean a row no login can ever reach.
  kinde_user_id text not null unique,

  -- NOT NULL is a judgment call — §2.1 says "citext, unique" and is silent on
  -- nullability, whereas it explicitly marks `username` as nullable. The
  -- contrast is read as deliberate, and every account originates from a Kinde
  -- signup that carries an email. Recorded as a judgment call in §3.6 of the
  -- architecture doc; if the legacy import turns up emailless rows this is one
  -- reviewed `alter column` to relax.
  email extensions.citext not null unique,

  first_name text,
  last_name text,

  -- Nullable per §2.1. Q3 (do we still need usernames at all, given there is no
  -- global search?) is open; the column exists so the answer can be "yes"
  -- without a migration, and unique so it cannot become ambiguous if it is.
  username extensions.citext unique,

  -- Sensitive. Readable only through the `users` select policy, i.e. by the
  -- person themselves, their connections, and people they share an event with.
  phone_number text,

  bio text,
  company_name text,
  company_role text,

  -- A path into a *private* Storage bucket, never a public URL (§6.5). Profiles
  -- are graph-gated; a public bucket URL would be an ungated copy of gated data.
  photo_path text,

  -- Text + CHECK rather than a Postgres enum, per §2.1. An enum would make
  -- adding a state a schema-rewrite; a CHECK makes it a one-line migration that
  -- still cannot be bypassed by application code.
  status text not null default 'active'
    check (status in ('active', 'suspended', 'deleted')),

  is_admin boolean not null default false,
  email_verified boolean not null default false,
  has_completed_signup boolean not null default false,
  email_opt_in boolean not null default false,

  -- Migration traceability only (§6.2). UNIQUE so that re-running the legacy
  -- import cannot silently create a second copy of the same person — the
  -- second run fails loudly instead.
  legacy_user_id bigint unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is
  'One row per human. No personas, no alternate profiles (§2.1). Read access is '
  'graph-gated by the policy in 20260809211100 — this table is structurally '
  'unable to answer "list all users".';

comment on column public.users.kinde_user_id is
  'Kinde `sub`. The only link between an authenticated session and this row (§5.3). '
  'Deliberately not user-updatable: see the column grants in 20260809211100.';

comment on column public.users.is_admin is
  'Privilege flag. Deliberately excluded from the column-level UPDATE grant so a '
  'compromised client cannot promote itself, regardless of what RLS allows.';

comment on column public.users.photo_path is
  'Object path inside the private `profile-photos` bucket, not a URL. Served via '
  'short-lived signed URLs so profile photos stay as gated as the profile (§6.5).';

create trigger users_set_updated_at
  before update on public.users
  for each row execute function private.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- social_links
-- ---------------------------------------------------------------------------
create table public.social_links (
  id uuid primary key default gen_random_uuid(),

  -- Cascade is specified directly by §2.1 ("FK -> users, cascade delete"): a
  -- social link has no meaning without the person it belongs to.
  user_id uuid not null references public.users(id) on delete cascade,

  platform text not null,
  url text not null,

  -- Presentation order on the profile. Defaulted rather than required so a
  -- caller that does not care about ordering still produces a valid row.
  display_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.social_links is
  'Off-platform handles shown on a profile. Gated by exactly the same rule as the '
  'profile itself (§3.4) — anything looser would be a searchable handle directory '
  'attached to a product whose premise is that strangers cannot find you.';

-- Every profile read fetches this table by user_id, and the FK needs an index
-- regardless (an unindexed FK turns a delete of one user into a sequential scan).
create index social_links_user_id_idx on public.social_links (user_id);

create trigger social_links_set_updated_at
  before update on public.social_links
  for each row execute function private.tg_set_updated_at();
