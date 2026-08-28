-- =============================================================================
-- 20260828180000_fn_own_cities_met_in.sql
--
-- WHAT THIS CHANGES
--   Adds `public.own_cities_met_in()` — the count behind `DESIGN.md` §3's
--   third ring band, "cities met people in". No table changes, no policy
--   changes, nothing else touched.
--
-- WHY THIS EXISTS NOW AND NOT BEFORE
--   §3's third band has been specified since the design was handed over and
--   has never been drawn. Both places that would have drawn it record the
--   same reason — `profile/page.tsx` and `card-preview-service.ts` each say
--   `meeting_locations.place_label` "is a venue or neighbourhood name, not a
--   city", and that counting distinct labels and calling them cities would be
--   "a number the app cannot stand behind". 20260828170000 adds
--   `city_label`, written from the geocoder's own `place` feature rather than
--   parsed out of anything, which is the fact that was missing.
--
-- WHY A FUNCTION RATHER THAN A POSTGREST QUERY
--   `count(distinct ...)` is not expressible through PostgREST, so the
--   alternative was selecting every city name the caller can see and
--   de-duplicating them in TypeScript. That works and was rejected for the
--   reason `attendance-count.ts` sets out at length about its own number: an
--   aggregate that returns ROWS to compute a COUNT is the bug that module
--   exists to have fixed. Here the rows would be city names — the caller's
--   own, so not a disclosure, but there is no reason for any of them to cross
--   the wire when the answer is one integer.
--
-- WHY IT CANNOT COUNT SOMEBODY ELSE'S CITIES
--   No argument. The subject is `private.current_user_id()` and there is no
--   parameter that could name another person — the same shape
--   `own_attended_events()` (20260828150000) and `is_verified_host()` use,
--   and the reason those are safe to grant to `authenticated` at all. Asking
--   "which cities has Sam met people in?" is not expressible.
--
--   Note that this deliberately does NOT reuse the `meeting_locations` SELECT
--   policy's reach. That policy has a mutuals branch: with full consent and no
--   privacy override, a mutual connection may read a location from a meeting
--   they were not part of. Counting through it would answer "cities I can see
--   a location for", which would include cities where OTHER people met each
--   other — a wrong number, and a stranger one the further the graph spreads.
--   The join below goes through `meeting_participants` and requires the
--   caller's own row, so it counts only meetings the caller was actually at.
--
--   `marked_private` is deliberately not consulted. It hides a meeting from
--   the other participant's mutuals, not from the person who set it; a
--   participant's own history is their own, and excluding it would make the
--   band silently undercount for anybody using the privacy control as
--   designed.
-- =============================================================================

create or replace function public.own_cities_met_in()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct ml.city_label)::integer
    from public.meeting_participants mp
    join public.meeting_locations ml on ml.meeting_id = mp.meeting_id
   where mp.user_id = private.current_user_id()
     and ml.city_label is not null;
$$;

comment on function public.own_cities_met_in() is
  'How many distinct cities the CALLER has met people in (DESIGN.md §3''s '
  'third ring band). Counts only meetings the caller was a participant of — '
  'deliberately NOT everything the meeting_locations SELECT policy would let '
  'them read, whose mutuals branch reaches meetings they were not part of. '
  'Takes no argument and reads only private.current_user_id(), so it cannot '
  'be pointed at anybody else. Counts from 2026-08-28 forward: city_label '
  'was added that day and nothing was backfilled, so this reads low rather '
  'than wrong for older meetings.';

revoke all on function public.own_cities_met_in() from public, anon;
grant execute on function public.own_cities_met_in() to authenticated;
