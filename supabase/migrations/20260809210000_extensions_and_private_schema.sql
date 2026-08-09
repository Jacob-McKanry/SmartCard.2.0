-- =============================================================================
-- 20260809210000_extensions_and_private_schema.sql
--
-- WHAT THIS CHANGES
--   1. Installs the two Postgres extensions the schema depends on (citext,
--      pgcrypto) into the `extensions` schema.
--   2. Creates a `private` schema that holds the RLS helper functions, and
--      locks it so no client-facing role can see into it.
--   3. Flips Supabase's default table privileges in `public` from
--      "grant everything to anon + authenticated" to "grant nothing", so a
--      table added in a future migration is unreachable until someone
--      deliberately grants access.
--   4. Adds the shared `updated_at` trigger function used by the few tables
--      that carry an `updated_at` column.
--
-- WHY
--   This is the foundation migration for the schema described in
--   docs/architecture/2026-08-09-initial-architecture-proposal.md §2/§3.
--   Nothing here creates data; it creates the conditions under which the rest
--   of the schema is safe to add.
--
--   The default-privilege change (3) is the important part. Out of the box,
--   Supabase runs `alter default privileges ... grant all on tables to anon,
--   authenticated`, so *every new table in `public` is world-readable to any
--   API caller the moment it is created* — RLS is the only thing standing in
--   the way, and RLS is off by default too. That is the exact opposite of the
--   posture in §3.1 ("default deny on every table"). Flipping the default means
--   a future migration that forgets `enable row level security` produces a table
--   nobody can read, rather than a table everybody can read. Wrong-direction
--   failures are the whole design principle of this schema (§2.4).
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   - `private` schema: usage revoked from PUBLIC, `anon` and `authenticated`.
--     Only the database owner (and roles with BYPASSRLS, i.e. `service_role`)
--     can reference anything inside it. This matters because the helpers added
--     in 20260809210900 are `security definer` and answer questions about the
--     social graph; if a client could call them directly they would become a
--     graph-probing oracle, which §3.3 explicitly rules out.
--   - `public` schema future tables: `anon` and `authenticated` are granted
--     nothing by default. Each later migration grants the specific verbs its
--     table needs, next to the policy that decides which rows those verbs see.
-- =============================================================================

-- citext: `users.email` and `users.username` are case-insensitive identifiers
-- (§2.1). Doing this with a type rather than `lower()` everywhere means the
-- uniqueness guarantee is structural — "Jacob@x.com" and "jacob@x.com" cannot
-- both exist even if some future code path forgets to normalise.
--
-- pgcrypto: already present on this project, declared here so the dependency is
-- visible in version control rather than assumed. (Note: `gen_random_uuid()`,
-- used for every primary key, is core Postgres since 13 and does not actually
-- require pgcrypto on PG17 — pgcrypto is kept for the hashing functions the
-- contacts-import service will need in a later phase.)
--
-- Both go in `extensions`, not `public`: extensions installed into `public`
-- are flagged by Supabase's own security linter, and keeping `public` free of
-- extension objects keeps the PostgREST-exposed surface to our tables only.
create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Private schema for RLS helper functions
-- ---------------------------------------------------------------------------
create schema if not exists private;

comment on schema private is
  'Holds security definer helper functions used by RLS policies (§3.1). Not '
  'exposed via PostgREST and not usable by anon/authenticated: these functions '
  'answer questions about the social graph and must never be callable directly.';

revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Default deny for anything added to `public` later
-- ---------------------------------------------------------------------------
-- Only the defaults attributed to `postgres` are changed, because `postgres` is
-- the role our migrations run as and therefore the role that will own every
-- table this project creates.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared `updated_at` maintenance
-- ---------------------------------------------------------------------------
-- `updated_at` is only trustworthy if the database maintains it. Leaving it to
-- application code means the one path that forgets to set it produces a row
-- that silently claims to be older than it is — which matters here because
-- `users.updated_at` is what a future profile-sync job would use to decide
-- what changed.
--
-- `set search_path = ''` on every function in this project is not decoration:
-- an unpinned search_path lets anyone who can create objects in a schema
-- earlier in the path shadow a function or operator this body relies on, and
-- have it run with the definer's rights. §3.1 calls this out explicitly. The
-- pin is applied to invoker-rights functions too, so the rule has no exceptions
-- to remember.
create or replace function private.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.tg_set_updated_at() from public;
revoke all on function private.tg_set_updated_at() from anon, authenticated;
