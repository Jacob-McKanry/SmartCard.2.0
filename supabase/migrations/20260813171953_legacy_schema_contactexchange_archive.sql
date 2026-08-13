-- =============================================================================
-- 20260813171953_legacy_schema_contactexchange_archive.sql
--
-- WHAT THIS CHANGES
--   Creates a new `legacy` schema containing one table,
--   `legacy.contactexchange`, a faithful column-for-column mirror of the old
--   SmartCard `contactexchange` table (1,813 rows). RLS is enabled and FORCEd
--   with **no policies at all**, and no privileges are granted to `anon` or
--   `authenticated`, so the table is reachable only by the service role /
--   dashboard. The 1,813 rows themselves are loaded separately as one-time
--   operational data (supabase/seed/), not by this migration.
--
-- WHY THIS TABLE IS ARCHIVED RATHER THAN MIGRATED
--   Architecture doc §6.7 decided that `contactexchange` is NOT migrated into
--   the new model. It is the legacy app's *one-directional* contact-capture
--   data: "person X tapped/scanned card owned by Y, here are X's details".
--   That is precisely the shape of a follow edge. SmartCard 2.0's core product
--   rule (README, CLAUDE.md) is that a connection exists only as a *mutual*
--   record created by verified in-person contact, and `public.connections`
--   enforces that structurally via CHECK (user_a_id < user_b_id) + UNIQUE.
--   Loading this data into `connections`/`meetings` would manufacture edges
--   that were never mutual and were never verified by the new NFC/GPS rules —
--   reintroducing follow-style relationships through the back door.
--
--   It is kept (rather than discarded) because it is real history the owner may
--   need for support questions or analysis. The compromise is: preserve the
--   bytes, make them unreachable from application code.
--
-- WHY A SEPARATE SCHEMA, NOT A TABLE IN `public`
--   `public` is the PostgREST-exposed schema. Anything in it is one missing
--   grant away from being queryable over the API, and it also shows up in
--   generated types, which invites a future developer to "just join" against
--   it. A separate `legacy` schema that is not in PostgREST's exposed-schema
--   list cannot be reached over the REST/GraphQL API at all, whatever the
--   grants say. That is defence in depth in the same spirit as the `private`
--   schema created in 20260809210000.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: none, to anyone. `anon` and `authenticated` get no USAGE on the
--     schema and no privileges on the table.
--   Forbids: everything, to every client role. With RLS enabled and zero
--     policies, even a role that somehow obtained table privileges would read
--     zero rows. Roles with BYPASSRLS (`postgres`, `service_role`) can still
--     read it — that is the intended and only access path, matching how
--     `connection_attempts`, `app_config` and `pending_connections` are handled
--     (architecture §3.5, "service-role-only tables").
--
-- WHY THE LEGACY INTEGER IDS ARE KEPT AS-IS AND NOT REMAPPED TO UUIDs
--   `card_owner_legacy_user_id` and `sender_legacy_user_id` deliberately stay
--   as the old integer ids with NO foreign key to `public.users`. Two reasons:
--     1. A real FK would make this archive a live participant in the graph —
--        exactly what §6.7 forbids — and would tie user deletion to it.
--     2. An archive should record what the old system actually stored. The
--        integers remain joinable by hand through `public.users.legacy_user_id`
--        if someone ever needs to, which is the right amount of friction.
--   (Checked at import time: all 1,813 rows' owner ids and all 518 non-null
--   sender ids do resolve to imported users, so nothing is orphaned in
--   practice — the FK is omitted on purpose, not because it would fail.)
-- =============================================================================

create schema if not exists legacy;

comment on schema legacy is
  'Read-only archive of legacy SmartCard data that is deliberately NOT part of '
  'the new data model (§6.7). Not in PostgREST''s exposed-schema list and not '
  'usable by anon/authenticated: nothing in here may be reachable from '
  'application code.';

revoke all on schema legacy from public;
revoke all on schema legacy from anon, authenticated;

create table legacy.contactexchange (
  -- The legacy primary key, preserved verbatim so a row here can always be
  -- traced back to the row it came from in the old database.
  legacy_id bigint primary key,

  -- Legacy integer user ids, intentionally without FKs (see header).
  card_owner_legacy_user_id bigint not null,
  sender_legacy_user_id bigint,

  -- Contact details the sender typed into the old capture form. 🔒 All of this
  -- is real personal data (names, emails, phone numbers, free-text notes),
  -- which is the other reason this table is service-role-only.
  sender_name text,
  sender_email text,
  sender_phone text,
  notes text,

  created_at timestamptz not null
);

comment on table legacy.contactexchange is
  'Frozen archive of the legacy one-directional contact-capture table (§6.7). '
  'Never joined to public.users, never mapped into connections/meetings — that '
  'would create non-mutual, unverified edges the product rule forbids. '
  'Contains 🔒 personal data; service-role/dashboard access only.';

comment on column legacy.contactexchange.sender_legacy_user_id is
  'Null when the sender was not a registered legacy user (1,295 of 1,813 rows) '
  '— the old form accepted contact details from non-users.';

alter table legacy.contactexchange enable row level security;
alter table legacy.contactexchange force row level security;

revoke all on legacy.contactexchange from anon, authenticated;
