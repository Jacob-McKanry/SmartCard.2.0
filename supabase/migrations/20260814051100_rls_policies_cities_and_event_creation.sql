-- =============================================================================
-- 20260814051100_rls_policies_cities_and_event_creation.sql
--
-- WHAT THIS CHANGES
--   Two access decisions, both about `events` and the list it now depends on:
--
--     1. `public.cities` becomes readable — SELECT to `authenticated`, and
--        nothing else to anybody.
--     2. Q5 is resolved: **any signed-in user may create an event**, as
--        themselves. This adds the INSERT policy and INSERT grant on
--        `public.events` that 20260809211300 deliberately did not create, and
--        extends the existing host UPDATE grant to cover the three columns
--        20260814051000 added.
--
-- WHAT THIS GRANTS, EXACTLY, AND TO WHOM
--
--   public.cities
--     GRANTS   SELECT on every column, to `authenticated`, for every row —
--              including inactive ones (see below).
--     FORBIDS  INSERT, UPDATE and DELETE to every client role. There is no
--              write policy and no write grant, so the list can only be edited
--              with the service role or by a migration. This is `app_config`'s
--              posture (§3.5) with one difference: `app_config` is not readable
--              either, because publishing verification thresholds tells an
--              attacker how far away they may stand. A city list has no such
--              property — it is the contents of a dropdown.
--     `anon`   gets nothing, here as everywhere.
--
--     Why the SELECT policy is `using (true)` rather than `using (is_active)`:
--     an event held last month in a city that has since been deactivated still
--     has to render its city's name. Filtering inactive cities out of *pickers*
--     and *browse* is a query concern (`.eq("is_active", true)`, which
--     `listActiveCities` in `apps/web/src/server/events/events-service.ts`
--     does), not an access-control concern — there is nothing sensitive about
--     the row, and hiding it at the policy layer would produce events whose
--     city renders as blank.
--
--   public.events
--     GRANTS   INSERT on the fifteen descriptive columns below, to
--              `authenticated`, restricted by the policy to rows whose
--              `host_user_id` is the caller's own id.
--              UPDATE additionally on `city_id`, `capacity` and
--              `requires_approval` (adding to the existing grant), still
--              restricted by the existing policy to the caller's own events.
--     FORBIDS  Creating an event hosted by somebody else — the WITH CHECK makes
--              `host_user_id = private.current_user_id()` a condition of the
--              write, and it is the only "act as yourself" pattern used
--              anywhere in this schema.
--              Setting `id` or `created_at` at insert time: neither is in the
--              column grant, so both take their defaults. A client-chosen `id`
--              would let a caller pick an event id that something else already
--              refers to; a client-chosen `created_at` would let an event claim
--              to be older than it is.
--              DELETE, still, to everyone — unchanged from 20260809211300. An
--              event other people RSVP'd to is shared history.
--
--     Note the deliberate asymmetry: `host_user_id` IS in the INSERT grant
--     (you must be able to write your own id into it) and is NOT in the UPDATE
--     grant (an event cannot be handed to somebody else afterwards). That is
--     the same reasoning `cards.owner_user_id` gets in §3.6 — RLS cannot say
--     "this row but not that column", so the column list is where it is said.
--
-- WHY "ANY SIGNED-IN USER MAY CREATE AN EVENT" IS SAFE HERE
--   This is the half of Q5 that was still open, and it is worth stating why
--   the fail-closed default is being opened rather than kept:
--
--     * Creating an event grants the creator nothing over anybody else. It
--       creates a row describing a place and a time. It does not create an
--       edge, it does not make anyone's profile readable, and there is no
--       "connect" action anywhere on an event — connections still require an
--       NFC tap or a GPS-verified scan, and this migration does not touch a
--       single line of that path.
--     * The blast radius of a spam or fake event is that it appears in browse
--       for its city. That is a moderation problem with a moderation answer
--       (deactivate, or delete with the service role), not a security hole.
--     * The alternative — a host-approval step before someone may create an
--       event — is a whole product surface (who approves, on what basis, with
--       what appeal) that the pilot has no operator to staff.
--
--   The one thing to keep watching, because it is the actual sharp edge in
--   this feature and it predates this migration: a `going` RSVP to the same
--   event is a branch of the `users` read policy (`private.shares_event_with`,
--   §3.4). Anyone may now create a public event, so anyone may now create the
--   *context* in which two `going` RSVPs make two strangers' profiles mutually
--   readable. That was already reachable by RSVPing to somebody else's public
--   event; what is new is not needing to find one. It is not widened here — no
--   helper, policy or status rule around `shares_event_with` is touched by this
--   pass — and §3.6 already names that branch as the first thing to re-examine
--   if events outgrow the pilot. 20260814051200 narrows it slightly, by
--   refusing new `going` RSVPs to events that have already ended.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- cities
-- ---------------------------------------------------------------------------
grant select on public.cities to authenticated;

create policy "any signed-in user may read the city list"
on public.cities for select to authenticated
using (true);

-- ---------------------------------------------------------------------------
-- events — INSERT (Q5) and the widened host UPDATE grant
-- ---------------------------------------------------------------------------
grant insert (
  host_user_id,
  city_id,
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
  capacity,
  requires_approval,
  cover_image_path
) on public.events to authenticated;

-- Adds to the grant made by 20260809211300; the columns listed there stay
-- granted. Every one of these is descriptive or a rule about the host's own
-- event, which is the same test that migration applied to the original list.
grant update (
  city_id,
  capacity,
  requires_approval
) on public.events to authenticated;

create policy "create events only as yourself"
on public.events for insert to authenticated
with check (host_user_id = (select private.current_user_id()));
