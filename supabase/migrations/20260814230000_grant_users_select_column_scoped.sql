-- =============================================================================
-- 20260814230000_grant_users_select_column_scoped.sql
--
-- WHAT THIS CHANGES
--   Narrows `authenticated`'s SELECT on `public.users` from the whole table to
--   the eleven columns the app actually reads. Nothing else changes: the RLS
--   policy ("read self, connections, and co-attendees only", 20260809211100) is
--   untouched, and so is every other grant on the table.
--
-- WHY — THE INCONSISTENCY THIS CLOSES
--   20260809211000's header states the rule this schema is built on: "Column-
--   level grants do real security work here and are not a stylistic choice. RLS
--   cannot express 'you may update this row but not that column', so
--   `users.is_admin` ... [is] protected by narrowing the grant, not the policy."
--   That was applied to UPDATE on this table (nine columns, `is_admin` and
--   `status` deliberately absent) but not to SELECT, which stayed
--   `grant select on public.users to authenticated` — every column.
--
--   So a role holding a token for user A could read `kinde_user_id`,
--   `is_admin`, `status`, `email_verified`, `has_completed_signup`,
--   `legacy_user_id`, `created_at` and `updated_at` on every row RLS admits —
--   A's own row, every active connection's, and every co-attendee's. Two of
--   those are worth naming: `kinde_user_id` is the sole link between a person
--   and their identity provider (§2.1, §5.3), and `is_admin` is the flag the
--   retired `/internal/photo-backfill` page gated on, i.e. an inventory of who
--   is worth attacking.
--
-- WHY THIS IS HARDENING AND NOT AN OPEN HOLE — STATED HONESTLY
--   Nothing can reach it today. The minted Supabase token never leaves the
--   server (verified: no client component in `apps/web` references `supabase`,
--   `accessToken` or `Bearer`), so no browser can issue an arbitrary PostgREST
--   query as `authenticated`; every query against `users` is written in the
--   service layer with an explicit column list. This grant is the second lock
--   for the day one of those two things stops being true — most plausibly §5.2's
--   mobile client, or any future direct-PostgREST read path. Defence in depth is
--   the whole reason §3.1 puts the rules in Postgres rather than in TypeScript;
--   leaving one table's SELECT wide because the application layer happens to be
--   careful is exactly the reasoning that section rejects.
--
-- HOW THE COLUMN LIST WAS DERIVED — from the code, not from the schema
--   The union of every column the app selects from `users` through an
--   RLS-bound client:
--     profile-service.ts  PROFILE_COLUMNS — id, first_name, last_name, username,
--                         phone_number, bio, company_name, company_role,
--                         photo_path, email, email_opt_in
--     activity-service.ts / connections-service.ts / feed-service.ts —
--                         id, first_name, last_name, username, photo_path
--     photo-upload.ts     photo_path
--   `ensure-user.ts` reads `status` and `connect-service.ts` reads the tapper's
--   name, but both use the SERVICE ROLE, which bypasses grants entirely — so
--   neither needs a column here, and neither is affected.
--
-- WHY THE SECURITY DEFINER FUNCTIONS ARE UNAFFECTED
--   `private.are_connected`, `private.shares_event_with`, `can_see_meeting`,
--   `can_see_event` and `public.event_rsvp_queue` all run with the owner's
--   rights, not the caller's, so they keep reading whatever they already read.
--   `event_rsvp_queue` in particular still returns a host the profile fields of
--   people they cannot otherwise see — that is its documented job
--   (20260814051200) and this change does not narrow it.
--
-- VERIFIED BEFORE BEING WRITTEN, not after: run in a rolled-back transaction
--   against the live database as a real migrated user with the real policies in
--   force. All three query shapes above still return the caller's own row;
--   `is_admin`, `kinde_user_id` and `status` each raise 42501.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: SELECT on eleven named columns of `public.users`, to
--     `authenticated` only, still filtered per row by the unchanged RLS policy
--     (self, active connections, and people you are both `going` to an event
--     with).
--   Forbids: SELECT on `kinde_user_id`, `status`, `is_admin`, `email_verified`,
--     `has_completed_signup`, `legacy_user_id`, `created_at` and `updated_at`,
--     to every client role, on every row including the caller's own.
--   `anon` is granted nothing here, as everywhere else in this schema.
-- =============================================================================

revoke select on public.users from authenticated;

grant select (
  id,
  first_name,
  last_name,
  username,
  phone_number,
  bio,
  company_name,
  company_role,
  photo_path,
  email,
  email_opt_in
) on public.users to authenticated;

comment on column public.users.is_admin is
  'Privilege flag. Deliberately outside BOTH the authenticated SELECT grant '
  '(20260814230000) and the authenticated UPDATE grant (20260809211100): a '
  'client may neither read who is an admin nor make itself one.';

comment on column public.users.kinde_user_id is
  'The sole link to the identity provider (§2.1, §5.3). Written only by '
  'ensureUser() with the service role, from a signature-verified token, and '
  'outside the authenticated SELECT grant (20260814230000) so it is never '
  'readable by a client on any row.';
