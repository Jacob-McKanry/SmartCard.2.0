-- =============================================================================
-- 20260809210800_table_contact_import_and_pending_connections.sql
--
-- WHAT THIS CHANGES
--   Creates `public.contact_import_matches` (architecture doc §2.7) and
--   `public.pending_connections` (§2.8 — a schema slot for a deferred flow,
--   designed now so it can be built later without touching the graph tables).
--
-- WHY contact_import_matches STORES HASHES AND NOTHING ELSE
--   §2.7: salted hashes only, never raw contacts. If this table held phone
--   numbers and email addresses, a database breach would hand an attacker the
--   address book of every user who ever ran an import — a far larger blast
--   radius than the app's own data. Hashing with a server-held salt means the
--   rows are only useful to code that already holds the salt.
--
--   The critical structural property, restated from §2.7: **this table has no
--   code path to `connections`.** Matching someone in your contacts tells you
--   they exist here; it never creates an edge. That is what keeps §4.7 threat 4
--   (mass fake-account farming) closed — an attacker who uploads a million
--   phone numbers gains zero connections, because the only writer to
--   `connections` is createVerifiedConnection().
--
-- WHY pending_connections IS BUILT NOW BUT UNREACHABLE
--   §2.8 designs the non-user flow ("I met someone who isn't on SmartCard yet")
--   and defers building it. It hangs off `connection_sessions`, the same table
--   QR and NFC already use, so when it is built it slots in without touching
--   connection or graph tables. Creating the table now costs nothing and keeps
--   the deferred design in version control instead of in someone's memory.
--   §3.5 puts it in the service-role-only set, so it gets no policy and no
--   grant: until the flow is built, no client can read or write it at all.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- contact_import_matches
-- ---------------------------------------------------------------------------
create table public.contact_import_matches (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: these rows are derived from one person's address book and are
  -- their data alone.
  owner_user_id uuid not null references public.users(id) on delete cascade,

  -- The SmartCard user this contact turned out to be, if any. SET NULL rather
  -- than cascade: losing the match should not delete the owner's record that a
  -- contact was imported.
  matched_user_id uuid references public.users(id) on delete set null,

  -- Salted hash of a phone number or email. The salt lives in the server
  -- environment (CONTACT_HASH_SALT, §7.4), never in the database, so a dump of
  -- this table alone cannot be dictionary-attacked back to a contact list.
  contact_hash text not null,

  -- The name as it appeared in the owner's own address book, kept so the UI can
  -- say "this is the Sarah you have saved as 'Sarah — work'". Sensitive: it is
  -- the owner's private annotation about another person.
  display_name_snapshot text,

  matched_at timestamptz,
  dismissed_at timestamptz,

  -- §2.7. Re-running an import updates the existing row instead of accumulating
  -- duplicates, which also means a dismissal cannot be undone by simply
  -- re-importing.
  constraint contact_import_matches_unique_per_owner
    unique (owner_user_id, contact_hash)
);

comment on table public.contact_import_matches is
  'Salted hashes of a user''s imported contacts and any SmartCard user they match '
  '(§2.7). Never stores raw contact details. Has no code path to `connections`: a '
  'match is a suggestion to go meet someone, never an edge.';

comment on column public.contact_import_matches.contact_hash is
  'Salted hash of a phone number or email address. Salt is server-side only, so a '
  'dump of this table cannot be reversed into anybody''s address book.';

create index contact_import_matches_matched_user_id_idx
  on public.contact_import_matches (matched_user_id);

-- ---------------------------------------------------------------------------
-- pending_connections  (deferred flow — §2.8)
-- ---------------------------------------------------------------------------
create table public.pending_connections (
  id uuid primary key default gen_random_uuid(),

  initiator_user_id uuid not null references public.users(id) on delete cascade,

  -- RESTRICT: the session is the proof that this meeting happened at all. The
  -- whole reason this table hangs off connection_sessions rather than standing
  -- alone is so that a pending connection carries the same verification
  -- evidence as a real one (§2.8, §4.7 threat 3).
  session_id uuid not null
    references public.connection_sessions(id) on delete restrict,

  -- Details of a person who is not (yet) a SmartCard user. All sensitive:
  -- these are contact details for someone who has not signed up and therefore
  -- has not agreed to anything.
  contact_name text,
  contact_email text,
  contact_phone text,

  place_label text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),

  occurred_at timestamptz,

  claimed_by_user_id uuid references public.users(id) on delete set null,
  claimed_at timestamptz,

  -- Values are not enumerated in §2.8; this set is the minimum the flow needs
  -- (offered, taken up, timed out, withdrawn). Recorded as a judgment call in
  -- §3.6 of the architecture doc — expect the phase that builds this flow to
  -- revisit it.
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'expired', 'cancelled')),

  -- A claim must record who and when, for the same reason a consumed session
  -- must (20260809210400): a half-written claim would be unattributable.
  constraint pending_connections_claim_is_attributed
    check (
      status <> 'claimed'
      or (claimed_at is not null and claimed_by_user_id is not null)
    ),

  -- You cannot claim your own pending connection — that would be a self-edge,
  -- and more to the point a free connection with no second party.
  constraint pending_connections_claimer_is_not_initiator
    check (claimed_by_user_id is null or claimed_by_user_id <> initiator_user_id)
);

comment on table public.pending_connections is
  'Schema slot for the deferred non-user flow (§2.8). No policy and no grant to '
  'anon/authenticated (§3.5) — unreachable by any client until the flow is built.';

create index pending_connections_initiator_user_id_idx
  on public.pending_connections (initiator_user_id);
create index pending_connections_session_id_idx
  on public.pending_connections (session_id);
create index pending_connections_claimed_by_user_id_idx
  on public.pending_connections (claimed_by_user_id);
