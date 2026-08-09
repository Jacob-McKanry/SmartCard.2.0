-- =============================================================================
-- 20260809210400_table_connection_sessions.sql
--
-- WHAT THIS CHANGES
--   Creates `public.connection_sessions` per architecture doc §2.5 — the row
--   that represents one live "I am presenting, come and connect to me" session,
--   for both the QR/GPS flow (§4.2) and the card-tap flow (§4.5).
--
-- WHY THIS TABLE IS THE CENTRE OF THE SECURITY MODEL
--   Every connection in SmartCard traces back to a row here, and single-use is
--   enforced at the *session* level rather than the token level (§4.2 step 6).
--   That is what defeats the screenshot-and-forward attack (§4.7 threat 1): the
--   instant anyone completes a scan the session is marked `consumed`, and every
--   token minted from it — including one screenshotted seconds earlier — is
--   dead, because validation checks the session's status, not just the token's
--   expiry.
--
--   The presenter's location columns are what defeat the live-video-relay
--   attack (§4.7 threat 2). Rotation does not help there: a friend watching a
--   FaceTime stream is looking at a genuinely current code. The only thing that
--   stops it is the server comparing two independently reported positions, with
--   a freshness bound so a stale fix cannot stand in for a current one.
--
-- ACCESS (policies in 20260809211200)
--   Presenter may SELECT their own session. Nobody may INSERT, UPDATE or DELETE
--   through RLS — sessions are created, rotated and consumed exclusively by the
--   verification service. This is not a gap: a client that could write
--   `current_nonce` or set `status` back to `active` would dismantle single-use
--   and, with it, threats 1 and 3.
-- =============================================================================

create table public.connection_sessions (
  -- This id is the `sid` embedded in the QR payload (§4.2 step 2). It is
  -- transmitted to whoever scans, so it must be unguessable on its own — hence
  -- a random UUID rather than anything sequential.
  id uuid primary key default gen_random_uuid(),

  method text not null check (method in ('qr_gps', 'nfc_card')),

  -- The person displaying the code / owning the tapped card. Cascade: a session
  -- is ephemeral personal state, meaningless once its owner is gone.
  presenter_user_id uuid not null references public.users(id) on delete cascade,

  status text not null default 'active'
    check (status in ('active', 'consumed', 'expired', 'revoked')),

  -- The nonce currently inside the displayed QR, and the one it replaced.
  -- `previous_nonce` exists purely for the rotation grace window: a scan that
  -- was in flight when the code rotated is a legitimate scan, and rejecting it
  -- would look like a broken product (§4.2 step 2). Both are nullable because
  -- an `nfc_card` session has no nonce at all.
  current_nonce text,
  nonce_issued_at timestamptz,
  previous_nonce text,

  -- The presenter's last reported position, refreshed by the ~20s heartbeat
  -- while the code is on screen (§4.2 step 3). Nullable because a session row
  -- exists before the first heartbeat lands, and card-tap sessions never have
  -- one. Absent or stale values must cause a rejection, not a pass — that
  -- decision lives in the verification service (§4.3), which does not exist
  -- yet; the nullability here is a statement about the column, not a relaxation
  -- of the rule.
  presenter_latitude double precision check (presenter_latitude between -90 and 90),
  presenter_longitude double precision check (presenter_longitude between -180 and 180),
  presenter_accuracy_m double precision check (presenter_accuracy_m >= 0),
  presenter_location_at timestamptz,

  -- Binds the session to the device that created it, so a session cannot be
  -- driven from a second device that obtained the sid (§4.7 threat 3).
  device_id text,

  expires_at timestamptz not null,
  consumed_at timestamptz,

  -- SET NULL rather than cascade: the session is a record of something that
  -- happened, and losing the fact that it was consumed at all would be worse
  -- than losing who consumed it.
  consumed_by_user_id uuid references public.users(id) on delete set null,

  -- "Presenter must not be the scanner" is validation step 6 in §4.2. Encoding
  -- it as a constraint means it holds even if a future code path forgets to
  -- check — you cannot connect to yourself, ever, through any route.
  constraint connection_sessions_presenter_is_not_scanner
    check (consumed_by_user_id is null or consumed_by_user_id <> presenter_user_id),

  -- A consumed session must say when and by whom. Without this a partially
  -- written consume step could leave a session that reads as spent but has no
  -- attributable counterpart, which would make the audit trail in
  -- `connection_attempts` un-reconcilable.
  constraint connection_sessions_consumed_is_attributed
    check (
      status <> 'consumed'
      or (consumed_at is not null and consumed_by_user_id is not null)
    )
);

comment on table public.connection_sessions is
  'One live presentation session for QR/GPS or card-tap connection (§2.5). '
  'Single-use is enforced here rather than on the token: consuming the session '
  'kills every token ever minted from it (§4.2 step 6).';

comment on column public.connection_sessions.current_nonce is
  'One-time value inside the currently displayed QR. Not a secret from the '
  'presenter (it is on their own screen); the secrecy that matters is from third '
  'parties, which the row-level select policy provides.';

comment on column public.connection_sessions.presenter_location_at is
  'Timestamp of the presenter''s last GPS heartbeat. Compared against '
  'app_config.presenter_location_max_age_seconds — this freshness bound is what '
  'stops a stale fix from standing in for a live one during a video relay '
  'attack (§4.7 threat 2).';

create index connection_sessions_presenter_user_id_idx
  on public.connection_sessions (presenter_user_id);
create index connection_sessions_consumed_by_user_id_idx
  on public.connection_sessions (consumed_by_user_id);

-- Supports the sweep that ages out sessions past `expires_at`, which is how
-- `active` stops meaning "active forever" if a client never closes cleanly.
create index connection_sessions_status_expires_at_idx
  on public.connection_sessions (status, expires_at);
