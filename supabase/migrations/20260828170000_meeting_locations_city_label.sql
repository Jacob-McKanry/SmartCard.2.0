-- =============================================================================
-- 20260828170000_meeting_locations_city_label.sql
--
-- WHAT THIS CHANGES
--   Adds one nullable column, `public.meeting_locations.city_label`. No policy
--   changes, no grant changes, no function changes, no data backfilled.
--
-- ===========================================================================
-- WHY A SECOND LABEL COLUMN RATHER THAN REUSING `place_label`
-- ===========================================================================
--   `place_label` is §2.4's venue name: "store a POI/venue name when the
--   provider returns one; when it only returns a street address, store a
--   coarser label instead". It is deliberately the MOST SPECIFIC thing the
--   geocoder could say — "Moscone Center", or failing that "SoMa, San
--   Francisco". That makes it exactly the wrong value to count cities with,
--   which is why `DESIGN.md` §3's third ring band ("cities met people in")
--   has never been drawn: `card-preview-service.ts` and `profile/page.tsx`
--   both record the same reason, that `place_label` "is a venue or
--   neighbourhood name, not a city", and that counting distinct labels and
--   calling them cities would be "a number the app cannot stand behind".
--
--   The owner asked (2026-08-28) for both: the nearest real thing a person
--   was at, AND the city, on the observation that the two correlate but are
--   not the same fact. Two columns is the honest shape of that: one answers
--   "where were you", the other answers "which city was that in", and a
--   count over the second is a claim the app can actually stand behind
--   because the geocoder said it in as many words rather than having it
--   inferred from a string.
--
--   The alternative — parsing a city back out of `place_label` by splitting
--   on the comma — was rejected outright. "SoMa, San Francisco" would work;
--   "Moscone Center" would silently yield nothing, and every POI label is
--   that shape, so the ring would undercount precisely for the venues the
--   owner most wants recorded. Mapbox already returns the `place` feature
--   separately in the same response this code was already making; storing
--   what it said costs one column and no extra request.
--
-- ===========================================================================
-- NULLABLE, AND WHY NOTHING IS BACKFILLED
-- ===========================================================================
--   Nullable for the same reason `place_label` is: geocoding fails open
--   (§2.4 — "if geocoding fails, place_label stays null and the meeting is
--   simply shown without a place name... a missing label is a cosmetic loss,
--   not a security one"). A meeting whose reverse-geocode failed, or which
--   predates this column, has no city and must read as "unknown", never as
--   an empty string that a `count(distinct)` would treat as a city of its
--   own.
--
--   No backfill, deliberately, and this is a real limitation to state rather
--   than gloss: every meeting_locations row that exists TODAY will have a
--   null city_label forever unless something re-geocodes it. Backfilling
--   means one paid Mapbox request per existing row, on a column whose only
--   consumer is a decorative ring — a cost and a vendor-terms question
--   (§2.4's storage-rights analysis) that belongs to a deliberate decision,
--   not to a migration adding a column. The ring therefore counts cities
--   from this point forward, and reads as a low number rather than a wrong
--   one.
--
-- ===========================================================================
-- WHY THIS COLUMN IS NO WIDER A DISCLOSURE THAN THE ROW IT SITS ON
-- ===========================================================================
--   `meeting_locations` already holds the exact latitude and longitude. A
--   city name is strictly coarser than the coordinates beside it, and it is
--   read through the same unmodified §3.2 policy — participants, or mutuals
--   only with every participant's consent and no privacy override. Nothing
--   about who can see this row changes; there is simply one more, less
--   precise, field on a row they could already read in full.
-- =============================================================================

alter table public.meeting_locations add column city_label text;

comment on column public.meeting_locations.city_label is
  'The city the meeting happened in, as the reverse geocoder named it '
  '(Mapbox''s `place` feature) — NOT parsed out of place_label, which is a '
  'venue or neighbourhood name and is frequently just "Moscone Center" with '
  'no city in it at all. Null when geocoding failed, when no city was '
  'returned, or for any row written before 2026-08-28: nothing was '
  'backfilled, so DESIGN.md §3''s cities band counts from that date forward. '
  'Nullable rather than defaulted for §2.4''s reason — a missing label is a '
  'cosmetic loss, and an empty string would count as a city of its own.';
