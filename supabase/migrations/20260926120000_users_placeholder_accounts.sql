-- =============================================================================
-- 20260926120000_users_placeholder_accounts.sql
--
-- WHAT THIS CHANGES
--   Part 1 of the "unverified connections" amendment recorded in
--   docs/architecture/2026-09-26-unverified-connections.md. This migration is
--   schema only — no RPC, no policy change beyond what is stated below.
--     1. `users.kinde_user_id` becomes nullable, and its plain UNIQUE
--        constraint is replaced by a partial unique index that only applies
--        `where kinde_user_id is not null` — so any number of placeholder
--        rows can coexist with a null identity.
--     2. `users.status`'s CHECK gains a fourth value, `'placeholder'`.
--     3. A new nullable `users.placeholder_source` column records how a
--        placeholder row was created (`'card_scan'`, `'manual_entry'`, ...).
--     4. `meetings.verification_method` and `connection_sessions.method`
--        both gain four new values: `'card_scan_ocr'`, `'badge_qr'`,
--        `'badge_nfc'`, `'manual_entry'`. `'qr_gps'`/`'nfc_card'` are
--        untouched, and so is everything about how they are enforced.
--
-- WHY A "PLACEHOLDER" USER ROW AT ALL, RATHER THAN A SEPARATE TABLE
--   The owner's explicit choice (four rounds of confirmed answers, recorded
--   in full in the architecture doc) is that scanning or typing in someone
--   who has no SmartCard account yet creates a REAL, full connections-graph
--   edge immediately — not a pending invite, not a separate address-book
--   entry. `connections.user_a_id`/`user_b_id` both reference `public.users`,
--   and `meeting_participants.user_id` does too — every table this graph
--   touches already assumes a real `users.id`. A separate "unclaimed
--   contact" table would mean either duplicating that entire graph shape for
--   a second kind of party, or writing translation logic at every read site
--   that already expects a plain `users` row. A placeholder row that IS a
--   `users` row, just one nobody can log into yet, is what lets every
--   existing read path (profile rendering, `are_connected`, the roster, Save
--   to Contacts) keep working with zero special-casing.
--
-- WHY `kinde_user_id` GOES NULLABLE INSTEAD OF GETTING A SENTINEL VALUE
--   The alternative — inventing a fake, unique `kinde_user_id` per placeholder
--   (e.g. a random string) — was rejected because it would be a LIE the
--   column's own name and comment ("Kinde `sub`. The only link between an
--   authenticated session and this row") does not support, and it would
--   require every future reader of this column to know that some values in
--   it are not real Kinde subjects. NULL says plainly "this row has no
--   identity behind it yet", which is the truth, and `ensureUser()`'s own
--   lookup (`findByKindeUserId`) already only ever searches by a real,
--   non-null value — a null `kinde_user_id` is structurally unreachable by
--   any login, exactly as intended.
--
-- WHY THE PARTIAL UNIQUE INDEX, NOT JUST DROPPING UNIQUE
--   Dropping uniqueness entirely would also permit two REAL accounts to
--   collide on the same `kinde_user_id`, which is the exact bug §5.3 calls
--   out as unrecoverable ("a duplicate would mean one Kinde identity
--   resolving to two SmartCard people"). `unique (kinde_user_id) where
--   kinde_user_id is not null` keeps that guarantee for every real identity
--   while placing no constraint at all between any number of nulls —
--   Postgres never treats two NULLs as equal for uniqueness purposes, but a
--   plain UNIQUE constraint on a nullable column already relies on that; the
--   partial index changes nothing about null handling, only makes the
--   "nullable now" intent explicit and keeps the index smaller.
--
-- WHY `'placeholder'` MUST NEVER BE TREATED AS "CAN LOG IN"
--   `assertActive()` in `apps/web/src/server/auth/ensure-user.ts` already
--   refuses to mint a session for any `status <> 'active'`, so a placeholder
--   row is unreachable at login with ZERO changes to that function — it is
--   simply one more value that fails the same check `'suspended'` and
--   `'deleted'` already fail. This migration relies on that existing
--   fail-closed default rather than adding a second, parallel check
--   anywhere, per this project's stated preference for one enforcement point.
--
-- WHY `placeholder_source` INSTEAD OF INFERRING IT FROM `meetings` LATER
--   The `meetings.verification_method` of the meeting that CREATED a
--   placeholder is a fact about that meeting, not durably about the person —
--   a placeholder can end up party to further meetings after creation
--   (someone else adds the same contact). Recording how the row itself
--   first came to exist, once, directly on `users`, is simpler than asking a
--   reader to find and trust "the first meeting mentioning this user" and
--   avoids that query being wrong the moment ordering assumptions change.
--
-- WHY THE FOUR NEW METHOD VALUES ARE ADDED HERE AND NOT LEFT FOR THE RPC
--   MIGRATION. `meetings.verification_method` and `connection_sessions.method`
--   are both CHECK constraints on tables that already exist; widening them is
--   independent of, and a prerequisite for, the new RPC in the next
--   migration (`create_manual_connection` cannot insert a row using a method
--   value the CHECK does not yet admit). Keeping this widening in the
--   schema-only migration, ahead of the function that depends on it, mirrors
--   how `20260828120000` widened `rate_limit_events.subject_kind` ahead of
--   the code that needed the new value.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: nothing new. `placeholder_source` is deliberately NOT added to
--   the column-scoped UPDATE grant on `users` (20260809211100) — it is
--   internal bookkeeping in the same category as `legacy_user_id`, written
--   only by the service role. It IS visible through the existing full-table
--   `grant select on public.users to authenticated` (RLS still decides which
--   ROWS, same as every other column on this table) — there is nothing
--   sensitive about a viewer who can already see a connection's profile also
--   seeing how that connection's account originated.
--   Forbids: nothing new is forbidden. A placeholder row remains completely
--   unreachable at login (existing `assertActive()` behaviour, unchanged),
--   and nothing here grants any role the ability to CREATE a placeholder —
--   that capability is added, service-role-only, by the next migration's
--   `create_manual_connection`.
--
-- VERIFIED LIVE in a rolled-back transaction before applying: a users row can
--   now be inserted with `kinde_user_id = null` and `status = 'placeholder'`;
--   two such rows can coexist (the partial index does not collide them); a
--   second row with a duplicate REAL `kinde_user_id` still fails exactly as
--   before; `meetings`/`connection_sessions` rows can now be inserted with
--   each of the four new method values and still refuse any value outside
--   the full set of six; existing `qr_gps`/`nfc_card` rows and the RLS
--   policies gating `users`/`meetings`/`connection_sessions` are unaffected.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. users.kinde_user_id -> nullable + partial unique index
-- ---------------------------------------------------------------------------
alter table public.users
  alter column kinde_user_id drop not null;

alter table public.users
  drop constraint users_kinde_user_id_key;

create unique index users_kinde_user_id_key
  on public.users (kinde_user_id)
  where kinde_user_id is not null;

comment on column public.users.kinde_user_id is
  'Kinde `sub`. The only link between an authenticated session and this row '
  '(§5.3). Nullable since 20260926120000: a placeholder row (status = '
  '''placeholder'') created by an unverified card-scan/manual add has no '
  'identity behind it yet. Enforced unique only among non-null values (a '
  'partial index, not a plain UNIQUE) so any number of placeholders can '
  'share a null identity without colliding. Deliberately not user-updatable: '
  'see the column grants in 20260809211100.';

-- ---------------------------------------------------------------------------
-- 2. users.status -> add 'placeholder'
-- ---------------------------------------------------------------------------
alter table public.users
  drop constraint users_status_check;

alter table public.users
  add constraint users_status_check
  check (status in ('active', 'suspended', 'deleted', 'placeholder'));

comment on column public.users.status is
  'active | suspended | deleted | placeholder. ''placeholder'' added '
  '20260926120000: a row created by scanning or manually adding someone with '
  'no SmartCard account yet. assertActive() in ensure-user.ts already '
  'refuses to mint a session for any status other than ''active'', so a '
  'placeholder row is unreachable at login with no change to that function — '
  'it fails the same way ''suspended''/''deleted'' already do.';

-- ---------------------------------------------------------------------------
-- 3. users.placeholder_source
-- ---------------------------------------------------------------------------
alter table public.users
  add column placeholder_source text
    check (placeholder_source in ('card_scan_ocr', 'badge_qr', 'badge_nfc', 'manual_entry'));

comment on column public.users.placeholder_source is
  'How this row first came to exist, when status = ''placeholder'' (or did, '
  'before being claimed by a real signup). Null for every ordinary account. '
  'Internal bookkeeping only — not in the client UPDATE grant, same category '
  'as legacy_user_id.';

-- ---------------------------------------------------------------------------
-- 4. Widen the two verification-method CHECKs together
-- ---------------------------------------------------------------------------
alter table public.meetings
  drop constraint meetings_verification_method_check;

alter table public.meetings
  add constraint meetings_verification_method_check
  check (verification_method in (
    'qr_gps', 'nfc_card', 'card_scan_ocr', 'badge_qr', 'badge_nfc', 'manual_entry'
  ));

comment on column public.meetings.verification_method is
  'qr_gps | nfc_card are the two originally-verified methods (§2.4/§4). '
  'card_scan_ocr | badge_qr | badge_nfc | manual_entry were added '
  '20260926120000 for create_manual_connection (next migration) — none of '
  'them carry any proximity or identity verification; see '
  'docs/architecture/2026-09-26-unverified-connections.md for why that '
  'requirement was deliberately removed.';

alter table public.connection_sessions
  drop constraint connection_sessions_method_check;

alter table public.connection_sessions
  add constraint connection_sessions_method_check
  check (method in (
    'qr_gps', 'nfc_card', 'card_scan_ocr', 'badge_qr', 'badge_nfc', 'manual_entry'
  ));

comment on column public.connection_sessions.method is
  'Mirrors meetings.verification_method''s CHECK exactly (widened together, '
  '20260926120000) — every meeting''s session and the meeting itself must '
  'agree on which method produced it.';
