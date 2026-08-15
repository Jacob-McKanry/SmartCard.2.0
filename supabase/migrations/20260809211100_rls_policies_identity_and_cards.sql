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

-- =============================================================================
-- AMENDMENT (2026-08-15) — SOCIAL LINKS ARE NOW DISCLOSED TO UNAUTHENTICATED
-- CALLERS ON ONE PATH, WHICH REVERSES WHAT THE `social_links` SECTION ABOVE
-- SAYS. NO SQL IN THIS FILE CHANGED.
--
-- Recorded here, next to the rule it departs from, per CLAUDE.md: "If
-- implementation reveals a reason to deviate from a signed-off architecture
-- decision, record the deviation and its reasoning where the original decision
-- lives."
--
-- WHAT THE RULE ABOVE SAYS
--   The `social_links` section states that links are "gated by exactly the rule
--   that gates the profile", and that anything looser — "say, 'readable by
--   anyone who has the user's id' — would be a searchable directory of people's
--   off-platform handles bolted onto a product whose premise is that strangers
--   cannot find you."
--
-- WHAT NOW HAPPENS THAT IT DID NOT
--   `apps/web/src/server/cards/card-preview-service.ts` — the non-user card
--   preview, built earlier the same day — reads `social_links` with the SERVICE
--   ROLE and renders the result as link tiles to a visitor with no account, on
--   `/card/<code>` and `/c/<token>`. The project owner asked for this
--   deliberately, having been shown what it costs.
--
-- WHAT DID *NOT* CHANGE, AND WHY THAT IS THE LOAD-BEARING PART
--   Every policy and every grant in this file is untouched. `anon` still has no
--   grant on `social_links`, no policy naming it, and no RPC that reads it. A
--   client presenting the publishable key still gets nothing, exactly as before.
--   The disclosure happens in one server module holding the service role, whose
--   header explains at length why a policy could not have served this reader
--   (there is no `auth.uid()` for one to be written against) and what the
--   TypeScript is therefore solely responsible for.
--
-- WHY THE PARAGRAPH ABOVE IS STILL RIGHT AND THIS IS STILL PERMITTED
--   Read the objection precisely: it is an objection to a DIRECTORY, and it
--   names the mechanism — "readable by anyone who has the user's id". That is
--   the case this path is not. There is no query in that module that takes a
--   user id, a name, a handle, a platform or a fragment of one. Its only inputs
--   are a physical card's code or an HMAC-signed, 45-second, rotating QR token,
--   and the person's id is derived from one of those by the server. A caller who
--   cannot already produce a credential reaches nothing at all.
--
--   So the thing that would make it a directory — being able to go from a handle
--   or a name to a person — remains impossible, and is now asserted rather than
--   argued: `no-second-write-path.test.ts` scans the whole source tree and fails
--   if any code pairs `.from("social_links")` with `.or`, `.ilike`, `.like` or
--   `.textSearch`, the same scan that has guarded `users` since the Connect
--   Flow. What is disclosed is a person's links to somebody who is holding their
--   card, which is what handing somebody a card has always meant.
--
--   It also follows a decision already made, on the same URL, hours earlier. That
--   route discloses a phone number and an email address to the same
--   unauthenticated caller. A public Instagram handle beside those is a strictly
--   smaller disclosure than either, and a line that withheld it while handing
--   over a mobile number would not have been a coherent one.
--
-- THE RESIDUAL, IN PLAIN LANGUAGE, BECAUSE THERE IS ONE
--   The set of a member's off-platform accounts is now reachable by anyone
--   holding their card's URL, permanently, until they revoke the card, with no
--   notification at the moment it happens. That is worse than the sum of its
--   parts in one specific way and it should be named: a name, a phone number, an
--   email and a set of social handles gathered in one place is a correlation aid.
--   Each is individually public-ish; together they are a starting point for
--   linking somebody's professional identity to their personal accounts. A
--   member who deliberately keeps a pseudonymous account off their SmartCard
--   profile is unaffected — this only ever shows links they themselves added to a
--   profile they knew was shown "identically to everyone" — but a member who
--   added a link expecting it to be seen only by people they had met in person
--   would be surprised, and nothing in the app has told them otherwise.
--
--   Bounded by the same four things bounding the rest of the preview, and by no
--   new ones: 48 bits of card-code entropy, a per-IP and a per-card hourly budget
--   (20260815120000), the owner's `revoked` kill switch, and one
--   `card_preview_views` audit row per disclosure surfaced on `/activity`. The
--   full accounting lives in the architecture doc's §4.7 threat 1 amendment,
--   which was updated in the same pass rather than left describing the narrower
--   disclosure.
--
-- WHAT WOULD MAKE THIS THE WRONG CALL, SO IT CAN BE NOTICED
--   A per-user "hide my links from card previews" column is the obvious next
--   control and was deliberately not added: the preview has no opt-out for phone
--   or email either, and adding one for links alone would imply the other two are
--   less sensitive, which is backwards. If the owner wants an opt-out it should
--   cover the whole preview, and §4.7 threat 1's amendment already records why
--   that needs a decision about what a tapped card then does rather than a
--   column.
-- =============================================================================
