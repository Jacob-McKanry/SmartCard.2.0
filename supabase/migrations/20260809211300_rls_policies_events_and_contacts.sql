-- =============================================================================
-- 20260809211300_rls_policies_events_and_contacts.sql
--
-- WHAT THIS CHANGES
--   Adds RLS policies and matching narrow grants for `events`, `event_rsvps`
--   and `contact_import_matches`, and records — explicitly, so it reads as a
--   decision rather than an omission — that `connection_attempts`, `app_config`
--   and `pending_connections` get no policy and no grant at all.
--
-- THE ONE DELIBERATE "VISIBLE TO ANY AUTHENTICATED USER" IN THIS SCHEMA
--   The `events` select policy has a branch that is true for every
--   authenticated caller: `visibility = 'public'`. Everywhere else in this
--   database such a branch would be exactly the thing §3.4 forbids. Here it is
--   justified, and the difference is worth being precise about rather than
--   waving at:
--
--     * A `users` row is a person. An always-true branch there is a global
--       directory of people, which is the one thing this product must never be.
--     * An `events` row is a place and a time. §2.6 makes the distinction
--       directly: "a public event at a public venue is meant to be found;
--       meeting location reveals where a specific person physically was.
--       Different data, different policy."
--     * Crucially, reading an event grants nothing transitively. It does not
--       reveal who is attending (`event_rsvps` below stays narrow), it does not
--       make any attendee's profile readable, and there is no "connect" action
--       reachable from it — connections still require a tap or a GPS-verified
--       scan. The blast radius of the exception is the event row itself.
--
--   The host's identity is on the row, but reading the row does not make the
--   host's `users` row readable: that still needs a graph relationship.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
-- No INSERT policy and no INSERT grant, on purpose. Q5 — "who can create events
-- for the pilot: anyone, or hosts only?" — is open in §8. The fail-closed
-- reading of an open question is that nobody may, so for now events are seeded
-- server-side with the service role. When Q5 lands, opening this up is a short
-- reviewed migration adding one policy and one grant; nothing else in this file
-- has to move.
--
-- UPDATE is limited to the host and is not column-restricted, because every
-- column on an event is descriptive: a host correcting a venue or a start time
-- affects presentation, not access. `host_user_id` is excluded from the grant
-- so an event cannot be handed to someone else, and `visibility` is included
-- deliberately — deciding whether your own event is public is the host's call.
--
-- No DELETE: an event other people RSVP'd to and met at is shared history.
grant select on public.events to authenticated;
grant update (
  title,
  description,
  starts_at,
  ends_at,
  timezone,
  venue_name,
  venue_address,
  latitude,
  longitude,
  visibility,
  cover_image_path
) on public.events to authenticated;

create policy "read public events, your own, and ones you are on the list for"
on public.events for select to authenticated
using ((select private.can_see_event(private.current_user_id(), events.id)));

create policy "hosts may edit their own events"
on public.events for update to authenticated
using (host_user_id = (select private.current_user_id()))
with check (host_user_id = (select private.current_user_id()));

-- ---------------------------------------------------------------------------
-- event_rsvps
-- ---------------------------------------------------------------------------
-- Read: your own answers, plus the answers of people you are actually connected
-- to. The full attendee list is deliberately NOT readable, even for a public
-- event. §3.3 sets the pattern: "you know 4 people going" is produced by
-- private.connections_attending(), which returns a computed answer restricted
-- to the caller's own graph — the database never hands over the list of
-- attendees, so RSVPing to a large public event cannot be used as a way to
-- enumerate the people at it.
--
-- Note that private.shares_event_with() — a branch of the `users` read policy —
-- still works despite this narrow policy, because it is `security definer` and
-- reads the table underneath RLS. That is the intended division of labour:
-- policies decide what rows a client may hold, helper functions decide what
-- questions the system will answer, and the two are tuned independently.
--
-- Write: your own RSVP, to an event you can already see. The `can_see_event`
-- check in WITH CHECK means you cannot RSVP your way into visibility of a
-- private event you were never told about — for a private event, the host or
-- the invite flow creates the row first. A caller also cannot RSVP on someone
-- else's behalf, since `user_id` must be their own in the post-image and is the
-- only value the grant lets them set.
grant select on public.event_rsvps to authenticated;
grant insert (event_id, user_id, status) on public.event_rsvps to authenticated;
grant update (status, responded_at) on public.event_rsvps to authenticated;
grant delete on public.event_rsvps to authenticated;

create policy "read your own rsvps and your connections' rsvps"
on public.event_rsvps for select to authenticated
using (
  user_id = (select private.current_user_id())
  or (select private.are_connected(private.current_user_id(), event_rsvps.user_id))
);

create policy "rsvp only as yourself, only to events you can see"
on public.event_rsvps for insert to authenticated
with check (
  user_id = (select private.current_user_id())
  and (select private.can_see_event(private.current_user_id(), event_rsvps.event_id))
);

create policy "change only your own rsvp"
on public.event_rsvps for update to authenticated
using (user_id = (select private.current_user_id()))
with check (user_id = (select private.current_user_id()));

create policy "withdraw only your own rsvp"
on public.event_rsvps for delete to authenticated
using (user_id = (select private.current_user_id()));

-- ---------------------------------------------------------------------------
-- contact_import_matches
-- ---------------------------------------------------------------------------
-- Strictly owner-only in every direction. These rows are derived from one
-- person's address book; nobody else has any business reading them, including
-- the people they matched — `matched_user_id` pointing at you does not give you
-- the right to know that someone has you in their contacts, let alone what name
-- they have you saved under (`display_name_snapshot`).
--
-- No INSERT policy: matching requires hashing the contact with the server-held
-- salt (CONTACT_HASH_SALT, §7.4). A client that could insert rows here would
-- either need the salt — which would destroy the point of hashing — or would be
-- writing hashes nothing can ever match. The import runs server-side.
--
-- UPDATE is granted on `dismissed_at` only: dismissing a suggestion is the one
-- thing a user does to these rows. DELETE is allowed so "forget my imported
-- contacts" is a real capability the user holds directly, which is likely to
-- matter for Q10 (hash retention window and user delete control).
--
-- Worth restating from §2.7 because it is the security property that makes this
-- table safe to have at all: there is no code path from here to `connections`.
-- A match is a prompt to go and meet someone, never an edge.
grant select on public.contact_import_matches to authenticated;
grant update (dismissed_at) on public.contact_import_matches to authenticated;
grant delete on public.contact_import_matches to authenticated;

create policy "read only your own contact matches"
on public.contact_import_matches for select to authenticated
using (owner_user_id = (select private.current_user_id()));

create policy "dismiss only your own contact matches"
on public.contact_import_matches for update to authenticated
using (owner_user_id = (select private.current_user_id()))
with check (owner_user_id = (select private.current_user_id()));

create policy "delete only your own contact matches"
on public.contact_import_matches for delete to authenticated
using (owner_user_id = (select private.current_user_id()));

-- ---------------------------------------------------------------------------
-- connection_attempts, app_config, pending_connections — intentionally empty
-- ---------------------------------------------------------------------------
-- No policies and no grants are created for these three tables. §3.5 names them
-- as service-role-only, and the reasoning is recorded with the tables
-- themselves (20260809210700 and 20260809210800):
--
--   connection_attempts  an audit log whose subjects must not be able to read
--                        or edit it, containing exactly the numbers §4.2 step 7
--                        forbids returning to a user.
--   app_config           the verification thresholds themselves; publishing them
--                        tells an attacker how far away they may stand.
--   pending_connections  a deferred flow (§2.8) with no client surface yet.
--
-- They still have RLS enabled and forced by 20260809211000, so with no policy
-- every row is denied to every non-BYPASSRLS role. Supabase's security linter
-- reports "RLS enabled, no policy" for tables in this state; on these three it
-- is the intended configuration and should not be "fixed".
-- =============================================================================
