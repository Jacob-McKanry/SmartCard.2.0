-- =============================================================================
-- 20260813210100_table_user_push_tokens.sql
--
-- WHAT THIS CHANGES
--   Creates `public.user_push_tokens`, the table sketched in the §4.5 amendment
--   (2026-08-13) and listed as Connect-Flow-phase work in §2.5 amendment (c).
--   One row per registered device per user, holding the Expo push token that
--   §7.5's push service delivers to.
--
-- WHY THIS TABLE EXISTS AT ALL — IT IS A SECURITY CONTROL, NOT A FEATURE
--   Q17 decided a card tap connects instantly with no confirmation step by the
--   card owner, because requiring one breaks the only thing a physical card is
--   good at (it works when handed over, or left on a table, or tapped while its
--   owner is mid-conversation). That decision removes the last preventive
--   control on the NFC path, so the design leans on a DETECTIVE one instead:
--   the owner is told the instant any tap commits, with revoke-card one tap
--   away. §4.7 threat 7 is explicit that the property which changed is
--   detection latency — weeks down to seconds. A kill switch is worthless if
--   its owner does not know to reach for it, and this table is how they find
--   out.
--
-- WHY THE DANGER HERE IS UNUSUAL, AND WHY THE READ RULE HAS NO GRAPH BRANCH
--   For every other sensitive table in this schema the risk is what a row
--   REVEALS. A push token reveals almost nothing; the risk is what it ENABLES.
--   Holding someone's token is a capability to deliver arbitrary notification
--   text to that person's lock screen — an impersonation channel ("Your
--   connection request was accepted", "Tap here to verify your account") aimed
--   at a specific named human. So the read rule is self-only with no branch for
--   a connection, a mutual, or a co-attendee. There is deliberately no
--   relationship in this product that argues for reading someone else's token,
--   and therefore no branch a well-meaning future edit could widen.
--
-- ACCESS GRANTED / FORBIDDEN
--   GRANTED to `authenticated`, on rows where user_id = the caller:
--     SELECT (all columns except `disabled_at`)
--     INSERT (user_id, expo_push_token, platform, device_id, last_seen_at)
--     UPDATE (expo_push_token, platform, last_seen_at)
--     DELETE
--   That is exactly what an app needs: register a token on launch, refresh it,
--   and clear it on logout.
--
--   FORBIDDEN:
--     * Any access at all to another user's rows — every policy below tests
--       user_id against private.current_user_id(), and there is no second
--       branch.
--     * Any access whatsoever for `anon` (as everywhere in this schema).
--     * Writing `user_id` on UPDATE. It is grantable on INSERT only, and the
--       INSERT policy pins it to the caller, so a row cannot be created for
--       somebody else and cannot later be moved to them.
--     * Reading or writing `disabled_at`, which is excluded from both the
--       SELECT and UPDATE grants. It is the server's bookkeeping (see below),
--       and a client able to clear it could keep a dead token being retried
--       forever. This uses the column-level-grant technique §3.6 already relies
--       on for `users.is_admin` — RLS cannot express "this row but not this
--       column", so the grant has to.
--   Sending is never done through any of this: it happens exclusively
--   server-side with the service role.
-- =============================================================================

create table public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),

  -- CASCADE, per the §4.5 sketch: a deleted user's devices must stop being
  -- addressable. A push token that outlives its owner is a live delivery
  -- channel to a person who no longer has an account.
  user_id uuid not null references public.users(id) on delete cascade,

  -- UNIQUE across the whole table, not just per user. Expo issues one token per
  -- app installation, so the same token appearing under two user ids means an
  -- installation changed hands (a shared or re-signed-in device) — and in that
  -- case the previous owner must lose it, not keep receiving that phone's
  -- notifications. Uniqueness makes the re-registration a conflict the server
  -- has to resolve rather than a silent duplicate.
  expo_push_token text not null unique,

  platform text not null check (platform in ('ios', 'android', 'web')),

  -- NOT NULL, unlike the §4.5 sketch which left it unstated. The sketch's own
  -- stated purpose for this column is "so a re-registered device replaces its
  -- own row rather than accumulating", and that property is delivered by the
  -- unique constraint below — which a NULL would silently opt out of, because
  -- NULLs never conflict in a Postgres unique index. A device with no id would
  -- therefore accumulate a new row on every launch, which is precisely the
  -- failure the column exists to prevent.
  device_id text not null,

  -- Refreshed on app launch. Stale rows get pruned; see the operational note.
  last_seen_at timestamptz not null default now(),

  -- Set when Expo reports the token is dead (`DeviceNotRegistered`, i.e. the
  -- app was uninstalled or the token rotated). Marking beats retrying forever:
  -- without it the send path slowly becomes mostly failures and REAL failures
  -- stop being visible — a monitoring problem that quietly disables the
  -- detective control this table exists to provide (§4.5 amendment's
  -- operational rule).
  disabled_at timestamptz,

  created_at timestamptz not null default now(),

  -- One row per (user, installation). An UPSERT on this constraint is how a
  -- device re-registers without accumulating rows.
  constraint user_push_tokens_one_row_per_device unique (user_id, device_id)
);

comment on table public.user_push_tokens is
  'Expo push tokens, one row per registered device per user (§4.5 amendment). '
  'Self-only read and write with no graph branch: a token is not a secret that '
  'reveals something, it is a capability to write on a named person''s lock '
  'screen, so there is no relationship that justifies another user holding it.';

comment on column public.user_push_tokens.expo_push_token is
  'Sensitive. Sending happens server-side with the service role only; this value '
  'never travels to another user by any path.';

comment on column public.user_push_tokens.disabled_at is
  'Server bookkeeping — excluded from the authenticated grants deliberately. Set '
  'when Expo reports DeviceNotRegistered so a dead token is not retried forever.';

-- Sending looks up "every live token for this user", which is this index.
create index user_push_tokens_user_id_idx
  on public.user_push_tokens (user_id) where disabled_at is null;

-- ---------------------------------------------------------------------------
-- RLS — the §3.1 default-deny pattern, then exactly the self-only access above
-- ---------------------------------------------------------------------------
-- All three lines matter and 20260809211000 explains why at length: `enable`
-- turns policies on, `force` stops the table owner being exempt from them, and
-- the `revoke` undoes Supabase's default grant of ALL on every new public table
-- to `anon` and `authenticated` — without which a table whose RLS was ever
-- accidentally disabled would be wide open to unauthenticated callers.
alter table public.user_push_tokens enable row level security;
alter table public.user_push_tokens force row level security;
revoke all on public.user_push_tokens from anon, authenticated;

grant select (id, user_id, expo_push_token, platform, device_id, last_seen_at, created_at)
  on public.user_push_tokens to authenticated;
grant insert (user_id, expo_push_token, platform, device_id, last_seen_at)
  on public.user_push_tokens to authenticated;
grant update (expo_push_token, platform, last_seen_at)
  on public.user_push_tokens to authenticated;
grant delete on public.user_push_tokens to authenticated;

create policy "read only your own push tokens"
on public.user_push_tokens for select to authenticated
using (user_id = (select private.current_user_id()));

create policy "register a token only for yourself"
on public.user_push_tokens for insert to authenticated
with check (user_id = (select private.current_user_id()));

-- USING and WITH CHECK are both present and both required. USING decides which
-- rows may be targeted; WITH CHECK decides what they may become. Omitting WITH
-- CHECK would let a caller update their own row into... their own row only, in
-- practice, since `user_id` is not in the UPDATE grant — but stating both keeps
-- the policy true on its own terms rather than relying on the grant list to
-- close it, which is the kind of coupling that breaks when someone widens a
-- grant later.
create policy "update only your own push tokens"
on public.user_push_tokens for update to authenticated
using (user_id = (select private.current_user_id()))
with check (user_id = (select private.current_user_id()));

create policy "delete only your own push tokens"
on public.user_push_tokens for delete to authenticated
using (user_id = (select private.current_user_id()));
