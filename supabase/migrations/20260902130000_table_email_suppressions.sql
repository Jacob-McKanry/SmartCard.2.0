-- =============================================================================
-- 20260902130000_table_email_suppressions.sql
--
-- WHAT THIS CHANGES
--   Adds `public.email_suppressions` — a do-not-mail list. No RPC, no policy,
--   no grant to any client role. This is the first piece of
--   `docs/architecture/2026-09-02-event-invite-email.md` (§5 of the attendee
--   import design, "email, as its own phase"): before anything sends a single
--   bulk email, there has to be somewhere a bounce, a spam complaint, or an
--   unsubscribe click can permanently land, and everything that sends mail
--   later has to check it first.
--
-- WHY THIS TABLE HAS NO RPC, UNLIKE EVERY OTHER TABLE THIS SESSION HAS ADDED
--   `event_attendee_imports` and its siblings gate access through a
--   `security definer` function keyed on `private.current_user_id()`, because
--   the question each of those tables answers is "what may THIS signed-in
--   person see or do". This table answers a different question with no
--   signed-in person in it at all: "should ANY mail go to this address, on
--   behalf of ANY host, regardless of who is asking" — suppression is a fact
--   about an email address, not about a caller, and it has to hold across
--   every future import from every future host. There is no `current_user_id()`
--   to key a policy on, and inventing one (e.g. "the importing host may read
--   rows they'd send to") would be actively wrong: a host must not learn
--   whether a stranger's address bounced or complained about somebody else's
--   event, and a bounce recorded against one host's send has to suppress the
--   address for every other host too.
--
--   The three real callers are the Resend bounce/complaint webhook, the
--   public unsubscribe link, and the send job itself — none of which run with
--   a Supabase user session, for the same structural reason `ensureUser()`
--   uses the service role (`service-role-client.ts`'s own header): the
--   identity that would key an RLS policy does not exist at the point these
--   run. `service-role-client.ts` warns that "adding a second caller is a
--   decision, not a convenience" — this is that decision, made explicitly and
--   for a reason structurally identical to the one already on record, not a
--   shortcut around a policy this table could otherwise have.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: none. `authenticated` and `anon` cannot SELECT, INSERT, UPDATE or
--     DELETE this table by any route, including PostgREST directly.
--   Forbids: everything, to everyone but the service role, which bypasses RLS
--     by definition and is used only from `server-only` TypeScript modules
--     under `apps/web/src/server/email/`.
--
-- VERIFIED LIVE in a rolled-back transaction before applying: no grant to
--   authenticated/anon on the table; a signed-in caller's own SELECT against
--   it errors outright (forced RLS, zero policy); a citext-case-insensitive
--   duplicate insert is a no-op under on-conflict-do-nothing, keeping the
--   FIRST recorded reason; an invalid `reason` value is refused by the CHECK
--   constraint. Re-verified against the deployed table: zero grants to
--   authenticated/anon, `relforcerowsecurity = true`, zero policies.
-- =============================================================================

create table if not exists public.email_suppressions (
  -- The address is the whole identity here — there is no user_id column and
  -- there must not be one. Most rows will belong to people who never signed
  -- up at all (a bounced address from a CSV import, an unsubscribe click from
  -- someone who deleted the email without ever visiting a claim link), so a
  -- foreign key into `users` would be null for the common case and would
  -- invite a future join that leaks suppression status through a user-shaped
  -- path. `extensions.citext` for the same reason `users.email` and
  -- `event_attendee_imports.email` both are: Sarah@x.com and sarah@x.com must
  -- suppress the same address.
  email extensions.citext primary key,

  -- Kept narrow on purpose. This is a boolean gate ("do not send"), not an
  -- audit trail of every event Resend ever reports for an address — a second
  -- bounce or complaint after the first does not need its own row, and
  -- `on conflict (email) do nothing` below means the reason recorded is
  -- whichever happened first.
  reason text not null check (reason in ('bounced', 'complained', 'unsubscribed')),

  suppressed_at timestamptz not null default now(),

  -- Resend's own event id, when the row came from a webhook, purely for
  -- tracing a suppression back to the delivery event that caused it during an
  -- investigation. Null for an unsubscribe-link suppression, which has no
  -- Resend event behind it.
  source_event_id text
);

comment on table public.email_suppressions is
  'A permanent do-not-mail list, keyed on the address rather than on any '
  'account. RLS is enabled and FORCED with no policy and no grant to any '
  'role: the only writers are the Resend bounce/complaint webhook and the '
  'public unsubscribe link, and the only reader is the send job that must '
  'check this before every message — none of which run with a Supabase user '
  'session, so there is no identity to key a policy on. See this migration''s '
  'header for why that makes the service role the right tool here rather than '
  'a shortcut around one.';

comment on column public.email_suppressions.reason is
  'Whichever of bounced/complained/unsubscribed happened FIRST for this '
  'address. Not an audit trail — a second event for an already-suppressed '
  'address is a no-op (on conflict do nothing), because this table answers '
  'one question (may we send) and does not need a history to answer it.';

alter table public.email_suppressions enable row level security;
alter table public.email_suppressions force row level security;

-- Intentionally: no policy, and no grant. See the header.
