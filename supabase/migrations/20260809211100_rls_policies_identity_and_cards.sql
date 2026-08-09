-- =============================================================================
-- 20260809211100_rls_policies_identity_and_cards.sql
--
-- WHAT THIS CHANGES
--   Adds RLS policies and the matching narrow grants for `users`,
--   `social_links` and `cards`.
--
-- WHY THIS IS THE MOST IMPORTANT POLICY FILE IN THE PROJECT
--   The `users` select policy is what forbids global search (§3.4). Every
--   branch of it names a specific relationship between the reader and the row:
--   it is you, it is someone you have a verified connection to, or it is
--   someone going to the same event as you. There is no branch that is true for
--   an arbitrary user, so "list all users" is not a question this database is
--   able to answer — not a question we have declined to build a screen for.
--   Reintroducing search would require consciously weakening this policy in a
--   reviewed migration, which is the point.
--
-- ONE ADDITION TO THE §3.4 POLICY TEXT, STATED PLAINLY
--   The policies below carry `to authenticated`, which the doc's example omits.
--   This only ever narrows: without a role clause a policy applies to PUBLIC,
--   which includes `anon`. `anon` has no grant on any table in this schema and
--   so is already denied, but naming the role means the policy is not even
--   evaluated for unauthenticated callers, and it documents at the policy site
--   that there is no such thing as an anonymous read here. The USING
--   expressions are the doc's, unchanged.
--
-- WHAT IS DELIBERATELY ABSENT
--   No INSERT policy on `users`. Rows are created by `ensureUser()` (§5.3)
--   during token exchange, before a Supabase JWT exists — that runs with the
--   service role. A client-side insert path would mean a client choosing its own
--   `kinde_user_id`, i.e. choosing which account it is.
--
--   No DELETE policy on `users`. Deletion is a soft state change
--   (`status = 'deleted'`) performed by an administrator; a hard delete cascades
--   into the graph and must never be one client request away.
--
--   No block filtering in the users select policy. §3.4's policy does not
--   include one, and blocks are enforced where they matter — at connection time
--   (§4.2 step 5.7, §4.5 step 4). Q4 (is block/report in pilot scope?) is still
--   open; if the answer is yes and blocking should also hide profiles, that is a
--   deliberate amendment to this policy, not something to slip in here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- GRANTS
--   SELECT on all columns to `authenticated`, filtered to graph-justified rows
--   by the policy below.
--
--   UPDATE on an explicit column list only. This is where the privilege
--   boundary actually lives: RLS can say "you may update your own row" but
--   cannot say "except that column". Everything a user legitimately edits about
--   themselves is in the list. Everything that decides what they are allowed to
--   do, or that ties the row to an external system, is not:
--     is_admin              - a self-update would be privilege escalation
--     status                - a user must not un-suspend themselves
--     email, email_verified - identity comes from Kinde, not from the client
--     kinde_user_id         - rebinding this would be account takeover
--     has_completed_signup  - the server asserts onboarding finished, not the
--                             client claiming it did
--     legacy_user_id, id, created_at, updated_at - not user data
--   A compromised or malicious client therefore cannot make itself an admin
--   even if it finds a way to bypass the API entirely and talk to PostgREST
--   directly with a valid user token.
grant select on public.users to authenticated;
grant update (
  first_name,
  last_name,
  username,
  phone_number,
  bio,
  company_name,
  company_role,
  photo_path,
  email_opt_in
) on public.users to authenticated;

-- §3.4, verbatim. Read: you, people you are actually connected to, and people
-- you are attending the same event as. Nothing else, ever.
create policy "read self, connections, and co-attendees only"
on public.users for select to authenticated using (
  id = (select private.current_user_id())
  or (select private.are_connected(private.current_user_id(), users.id))
  or (select private.shares_event_with(private.current_user_id(), users.id))
);

-- The WITH CHECK repeats the USING expression so a row cannot be updated *into*
-- somebody else's identity. Combined with `id` being absent from the column
-- grant this is redundant today; it is written anyway because the cost is zero
-- and the failure it prevents is total.
create policy "update only your own profile"
on public.users for update to authenticated
using (id = (select private.current_user_id()))
with check (id = (select private.current_user_id()));

-- ---------------------------------------------------------------------------
-- social_links
-- ---------------------------------------------------------------------------
-- Social links are profile content, so they are gated by exactly the rule that
-- gates the profile. Anything looser — say, "readable by anyone who has the
-- user's id" — would be a searchable directory of people's off-platform handles
-- bolted onto a product whose premise is that strangers cannot find you.
--
-- The insert/update grants are column-scoped so `user_id` cannot be rewritten,
-- which would otherwise let someone attach a link to another person's profile.
grant select on public.social_links to authenticated;
grant insert (user_id, platform, url, display_order) on public.social_links to authenticated;
grant update (platform, url, display_order) on public.social_links to authenticated;
grant delete on public.social_links to authenticated;

create policy "read social links of profiles you can already see"
on public.social_links for select to authenticated using (
  user_id = (select private.current_user_id())
  or (select private.are_connected(private.current_user_id(), social_links.user_id))
  or (select private.shares_event_with(private.current_user_id(), social_links.user_id))
);

create policy "add social links only to your own profile"
on public.social_links for insert to authenticated
with check (user_id = (select private.current_user_id()));

create policy "edit only your own social links"
on public.social_links for update to authenticated
using (user_id = (select private.current_user_id()))
with check (user_id = (select private.current_user_id()));

create policy "delete only your own social links"
on public.social_links for delete to authenticated
using (user_id = (select private.current_user_id()));

-- ---------------------------------------------------------------------------
-- cards
-- ---------------------------------------------------------------------------
-- Owner-only, and for a sharper reason than usual: `card_code` is the security
-- token (§2.2, Q1 resolved). Any policy that let a user read a card row they do
-- not own would hand them the value needed to impersonate that card in a tap.
-- There is no lookup-by-code path for clients at all — §4.5 step 4 resolves a
-- tapped code server-side with the service role, and the client's claim about
-- who owns a card is never trusted.
--
-- The single write path is the kill switch from §4.5: an owner can mark a lost
-- card `revoked`. The WITH CHECK confines the outcome to `assigned` or
-- `revoked`, so an owner can revoke and un-revoke their own card but cannot set
-- it back to `unassigned` — that would return a physical card they still hold to
-- the pool of blank inventory. `owner_user_id` is outside the column grant, so
-- a card cannot be handed to someone else from a client either; assignment is
-- an administrative act.
--
-- No INSERT and no DELETE policy: cards are physical objects, created in the
-- database only by the inventory import (§6.3).
grant select on public.cards to authenticated;
grant update (status) on public.cards to authenticated;

create policy "read only cards you own"
on public.cards for select to authenticated
using (owner_user_id = (select private.current_user_id()));

create policy "owners may revoke or restore their own card"
on public.cards for update to authenticated
using (owner_user_id = (select private.current_user_id()))
with check (
  owner_user_id = (select private.current_user_id())
  and status in ('assigned', 'revoked')
);
