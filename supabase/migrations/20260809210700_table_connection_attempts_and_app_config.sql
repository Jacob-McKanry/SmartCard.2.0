-- =============================================================================
-- 20260809210700_table_connection_attempts_and_app_config.sql
--
-- WHAT THIS CHANGES
--   Creates the two service-role-only tables from architecture doc §2.5:
--     public.connection_attempts   the verification audit log
--     public.app_config            the tunable thresholds the GPS gate reads
--   and seeds `app_config` with the six starting values given in §2.5.
--
-- WHY NEITHER TABLE IS READABLE BY USERS (§3.5)
--   `connection_attempts` records, for every rejected attempt, the computed
--   distance, both devices' accuracies, and the radius in force. §4.2 step 7 is
--   explicit that the user must never see any of those numbers: a rejection
--   message that leaked distance would turn repeated scanning into a range
--   finder for locating a specific person. It is also an audit log, and the
--   subjects of an audit log must not be able to edit it.
--
--   `app_config` holds the thresholds themselves. Publishing them tells an
--   attacker exactly how far away they may stand, how long a token lives, and
--   how stale a location fix may be before anyone notices — the same reasoning
--   as above, one level up. Both tables are read and written exclusively by
--   server-side code running with the service role, which bypasses RLS; neither
--   gets a policy or a grant in this schema.
--
-- WHY THE THRESHOLDS ARE ROWS AND NOT CONSTANTS
--   §4.3: GPS is genuinely unreliable indoors — convention centres, ballrooms,
--   basements. The radius will be wrong on day one and must be tunable while an
--   event is happening. A constant in TypeScript needs a deploy; a constant in
--   the mobile bundle needs an app store review. A row can be changed in
--   seconds, which is the point of §4.4's "watch logs live on day one, adjust
--   in real time".
-- =============================================================================

-- ---------------------------------------------------------------------------
-- connection_attempts
-- ---------------------------------------------------------------------------
create table public.connection_attempts (
  id uuid primary key default gen_random_uuid(),

  -- All three user/session references are SET NULL on delete, not CASCADE.
  -- An audit log that disappears when its subject does is not an audit log.
  -- Losing "which session" or "which user" degrades the record; losing the
  -- record entirely destroys the dataset §4.4 exists to produce.
  session_id uuid references public.connection_sessions(id) on delete set null,

  method text not null check (method in ('qr_gps', 'nfc_card')),

  scanner_user_id uuid references public.users(id) on delete set null,
  presenter_user_id uuid references public.users(id) on delete set null,

  -- Constrained to the two outcomes §4.2 describes (step 6 commits a success,
  -- step 7 writes a rejection with its reason). Recorded as a judgment call in
  -- §3.6 of the architecture doc, which does not enumerate these. Adding a third
  -- outcome deliberately requires a reviewed migration — for an audit table
  -- whose whole value is comparability across rows, that friction is a feature.
  outcome text not null check (outcome in ('success', 'rejected')),

  -- Free text rather than an enum: the set of rejection reasons will grow as
  -- the verification service is built (§4.3 lists six situations that all
  -- reject), and an over-tight constraint here would make the log refuse to
  -- record the very failures it exists to capture.
  rejection_reason text,

  -- The numbers §4.4 tunes the radius from. Note that this stores the *computed
  -- distance*, not the two raw coordinate pairs — the log needs to answer "what
  -- radius would have accepted 99% of genuine attempts?" and that question does
  -- not require retaining where anybody was.
  distance_m double precision,
  scanner_accuracy_m double precision,
  presenter_accuracy_m double precision,
  radius_config_used_m double precision,

  -- Hashed, never raw: an IP address is personal data and a rate-limiting
  -- signal, and only the second use needs the value to be reversible-to-itself.
  ip_hash text,
  user_agent text,

  created_at timestamptz not null default now()
);

comment on table public.connection_attempts is
  'Audit log of every verification attempt, successful or not (§2.5). No policy '
  'and no grant to anon/authenticated: service role only (§3.5). This is the '
  'dataset the GPS radius gets tuned from after the pilot (§4.4).';

comment on column public.connection_attempts.distance_m is
  'Server-computed distance between the two reported positions. Never returned to '
  'a user: §4.2 step 7 requires rejections to say only "you need to be near each '
  'other", because a numeric distance turns repeated scanning into a range finder.';

create index connection_attempts_session_id_idx on public.connection_attempts (session_id);
create index connection_attempts_scanner_user_id_idx on public.connection_attempts (scanner_user_id);
create index connection_attempts_presenter_user_id_idx on public.connection_attempts (presenter_user_id);
create index connection_attempts_created_at_idx on public.connection_attempts (created_at desc);

-- ---------------------------------------------------------------------------
-- app_config
-- ---------------------------------------------------------------------------
create table public.app_config (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),

  -- Which admin last changed a security threshold. SET NULL so the config row
  -- survives the person. Typed as a users FK (the doc does not specify a type)
  -- so the answer is a real identity rather than an unverifiable string —
  -- recorded as a judgment call in §3.6 of the architecture doc.
  updated_by uuid references public.users(id) on delete set null
);

comment on table public.app_config is
  'Server-side tunable thresholds for the connection-verification gate (§2.5). '
  'No policy and no grant to anon/authenticated: service role only (§3.5). '
  'Publishing these values would tell an attacker exactly how far away they may '
  'stand and how long a token lives.';

create index app_config_updated_by_idx on public.app_config (updated_by);

create trigger app_config_set_updated_at
  before update on public.app_config
  for each row execute function private.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: the six starting values from §2.5
-- ---------------------------------------------------------------------------
-- These are starting points chosen to be deliberately generous (150m is far
-- larger than "in the same room") so the pilot does not fail closed on everyone
-- at once while there is no data to tune from. §4.4: watch the rejection log on
-- day one and tighten from evidence.
insert into public.app_config (key, value, description) values
  ('qr_max_distance_m', '150'::jsonb,
   'Maximum server-computed distance in metres between scanner and presenter for a QR connection to be accepted (§4.3 check 5). Starting value per §2.5; tune from connection_attempts after the first pilot event.'),

  ('qr_max_accuracy_m', '100'::jsonb,
   'Accuracy floor in metres. If either device reports a fix worse than this the attempt is rejected as too imprecise to prove proximity (§4.3 check 3) — without a floor, a deliberately vague fix could fuzz its way inside the radius.'),

  ('qr_token_ttl_seconds', '45'::jsonb,
   'Lifetime of a signed QR token from issue to expiry (§4.2 step 2). Short enough that a screenshotted code is stale before it can usefully travel.'),

  ('qr_rotation_seconds', '30'::jsonb,
   'How often a new nonce is minted while the code is displayed (§4.2 step 2). Deliberately shorter than the TTL so there is always a grace window (previous_nonce) for a scan that was in flight when the code rotated.'),

  ('presenter_location_max_age_seconds', '90'::jsonb,
   'Maximum age of the presenter''s last GPS heartbeat (§4.3 check 1). This is the bound that stops a stale fix standing in for a live one during a video-relay attack (§4.7 threat 2).'),

  ('session_max_lifetime_seconds', '300'::jsonb,
   'Maximum lifetime of a connection session from creation (§4.2 step 1). Caps how long a single "Connect" screen stays capable of producing a connection.');
