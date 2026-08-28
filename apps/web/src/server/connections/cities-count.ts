import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Cities met people in" — `DESIGN.md` §3's third ring band, finally
 * answerable as of 2026-08-28.
 *
 * WHY THIS NUMBER DID NOT EXIST UNTIL NOW, WHICH IS WORTH KNOWING BEFORE
 * TRUSTING IT
 *
 * §3 has specified this band since the design was handed over, and both
 * screens that would draw it recorded the same refusal rather than
 * approximating: `meeting_locations.place_label` is a venue or neighbourhood
 * name ("Moscone Center", "SoMa, San Francisco"), so counting distinct labels
 * and calling the result cities would be, in `profile/page.tsx`'s own words,
 * "a number the app cannot stand behind". `city_label` (20260828170000) is
 * written from the geocoder's own `place` feature, so the count is now a fact
 * the geocoder asserted rather than one this app inferred from a string.
 *
 * THE HONEST LIMITATION: nothing was backfilled. Every meeting recorded before
 * 2026-08-28 has a null `city_label` and is invisible to this count, so an
 * established user's band will read lower than their real history until they
 * meet somebody new. That is the deliberate trade — see the migration for why
 * a backfill is one paid geocoding request per existing row plus a
 * vendor-terms question, and therefore its own decision rather than a side
 * effect of adding a column.
 *
 * COUNTED IN SQL, NEVER IN TYPESCRIPT. `own_cities_met_in()` returns one
 * integer and no rows: `count(distinct ...)` is not expressible through
 * PostgREST, and the alternative — selecting every city name and
 * de-duplicating here — is exactly the shape `attendance-count.ts` exists to
 * have fixed for its own number. The names are the caller's own data, so
 * fetching them would not be a disclosure; there is simply no reason for any
 * of them to cross the wire when the answer is a single number.
 *
 * SELF-ONLY BY CONSTRUCTION. The RPC takes no argument and reads
 * `private.current_user_id()`, so "which cities has Sam met people in?" is
 * not expressible — the same property `isVerifiedHost` and
 * `own_attended_events` rely on.
 */

/**
 * How many distinct cities the caller has met people in.
 *
 * THROWS RATHER THAN DEFAULTING TO ZERO, and the caller has to decide what a
 * failure means. This mirrors `countEventsAttended` deliberately, for the
 * reason its header gives: zero is a claim, not an absence. "You have met
 * people in 0 cities" is a statement about somebody's life; a band that
 * silently reads zero because a query failed is worse than a diagram with one
 * fewer ring. `profile/page.tsx` catches this and omits the band.
 */
export async function countCitiesMetIn(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc("own_cities_met_in");

  if (error) {
    throw new Error(`Failed to count cities met in: ${error.message}`, { cause: error });
  }

  // The RPC returns a bare integer. Anything else means its contract changed,
  // and reporting a number this module did not recognise would be the
  // "partial-but-wrong" outcome §7 rules out — so it throws and the band is
  // omitted rather than drawn from a guess.
  if (typeof data !== "number" || !Number.isFinite(data)) {
    throw new Error("own_cities_met_in returned an unexpected shape");
  }

  return data;
}
