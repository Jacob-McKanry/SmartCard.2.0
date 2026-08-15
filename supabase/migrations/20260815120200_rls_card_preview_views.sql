-- =============================================================================
-- 20260815120200_rls_card_preview_views.sql
--
-- WHAT THIS CHANGES
--   Applies §3.1's default-deny pattern to `public.card_preview_views`
--   (20260815120100), then grants back exactly one thing: a column-scoped
--   SELECT to `authenticated`, constrained by one policy to rows describing the
--   caller's own profile.
--
-- WHY THIS TABLE IS NOT SERVICE-ROLE-ONLY LIKE `connection_attempts`
--   §3.5's service-role-only tables are the ones whose contents would help an
--   attacker: `app_config` says how far away you may stand, `connection_attempts`
--   holds distances §4.2 step 7 forbids returning, `rate_limit_events` says how
--   much budget is left. This table is the opposite kind of thing. Its entire
--   purpose is to be READ by the person it is about — §4.7 threat 7's defence on
--   the card path is detection, and a detection record only the server can see
--   detects nothing. The Activity screen reads it through the caller's own
--   RLS-bound client, exactly like `listCardTapActivity` already reads
--   `connection_sessions` and `cards`.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION, PRECISELY
--
--   GRANTED
--     `authenticated`: SELECT on (id, viewed_at, source, surface, card_id,
--     session_id) only, and only for rows whose `subject_user_id` is the
--     caller's own `public.users.id`. In plain language: you can see that
--     somebody previewed your card, when, by which route, and whether they
--     saved your contact file.
--
--   FORBIDDEN
--     `authenticated`: INSERT, UPDATE, DELETE — no grant and no policy, on any
--     column. An audit log its subjects can edit is not an audit log (§3.5). A
--     cardholder cannot delete evidence that their details went out, and cannot
--     fabricate evidence that they did.
--
--     `authenticated`: SELECT on `subject_user_id`, `ip_hash` and `user_agent`,
--     for three separate reasons.
--       - `subject_user_id` is outside the grant because the policy already
--         pins it to the caller, so reading it back tells them only what they
--         already know. A policy predicate may reference a column the grant
--         withholds; that is how RLS and column grants divide the work
--         (20260809211000's header).
--       - `ip_hash` is the OTHER person's personal data. It is hashed, but a
--         hash a user can read is still a stable identifier for a stranger, and
--         handing every cardholder a way to tell "the same unknown device came
--         back four times" is a tracking primitive nobody asked for.
--       - `user_agent` is attacker-controlled text. Returning it to a user
--         means rendering a string a stranger chose in the cardholder's browser
--         — React escapes it, but the safer answer to "does this column need to
--         reach a client?" is no.
--
--     `anon`: everything, as everywhere else. This is worth stating explicitly
--     on THIS table of all tables, because this is the audit log of the
--     product's first unauthenticated read path and the obvious wrong turn
--     would be to give the same anonymous caller a way to read it. The preview
--     route reaches this table with the service role, server-side, and writes
--     to it; the anonymous browser on the other end of that request has no
--     database identity at all and never touches it.
--
--   Nothing is granted to `anon` by this migration, and no policy below names
--   any role other than `authenticated`.
--
-- WHY THE POLICY NAMES `to authenticated` EXPLICITLY
--   Same reason 20260809211100 gives: a policy with no role clause applies to
--   PUBLIC, which includes `anon`. `anon` has no grant here and would be denied
--   anyway, but naming the role means the policy is not even evaluated for an
--   unauthenticated caller, and it documents at the policy site that there is
--   no anonymous read of this table.
-- =============================================================================

alter table public.card_preview_views enable row level security;
alter table public.card_preview_views force row level security;

-- Required, not decorative: Supabase's default privileges grant ALL on every
-- new table in `public` to both `anon` and `authenticated`. Without this line a
-- brand-new table is wide open to unauthenticated callers.
revoke all on public.card_preview_views from anon, authenticated;

-- Column-scoped, for the reasons in the header. `subject_user_id`, `ip_hash`
-- and `user_agent` are deliberately absent.
grant select (id, viewed_at, source, surface, card_id, session_id)
  on public.card_preview_views to authenticated;

create policy "read only previews of your own profile"
on public.card_preview_views for select to authenticated using (
  subject_user_id = (select private.current_user_id())
);
