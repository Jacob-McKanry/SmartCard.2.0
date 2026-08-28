import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { geocodingApiKey } from "@/server/env";
import { serviceRoleClient } from "@/server/supabase/service-role-client";

/**
 * Reverse-geocoding a QR/GPS meeting's captured fix into
 * `meeting_locations.place_label` (§2.4, Q25).
 *
 * THE ONE INPUT THIS USES IS ONE ALREADY SPENT. §2.4's amendment is explicit
 * that this decision spends privacy budget already spent by the GPS proximity
 * gate — the same lat/lng that unlocked the connection, nothing new collected.
 *
 * WHY THIS FAILS OPEN, NOT CLOSED. §2.4: "if geocoding fails, `place_label`
 * stays null and the meeting is simply shown without a place name... a missing
 * label is a cosmetic loss, not a security one." This is the one place in the
 * connect path where degrading is correct — matches `push.ts`'s posture
 * exactly, down to the shape: every function here resolves rather than
 * throws, and the caller (`redeemQr`) awaits without letting any failure here
 * touch the HTTP response.
 *
 * WHY THIS RUNS AFTER THE COMMIT, NOT INSIDE IT. A slow or down geocoding
 * vendor must never turn "your connection failed" into the user-visible
 * outcome of a real, physically-verified meeting.
 *
 * WHY MAPBOX, AND WHY `permanent=true`. Checked against the terms of service
 * of each candidate before picking one, because this design retains the label
 * rather than displaying and discarding it (§2.4's own flag: check storage
 * terms first). Google's Geocoding API terms permit indefinite storage of
 * `place_id` only, not the formatted result. OSM Nominatim's policy is silent
 * on storage and expects self-hosting past casual volume. Mapbox has an
 * explicit permanent-storage tier built for exactly this, so every request
 * below carries `permanent=true` — see Q25's resolution in the architecture
 * doc for the full comparison.
 *
 * WHY ONE HTTP CALL, NOT TWO. Mapbox's reverse geocoding returns one feature
 * per requested `types` entry when a match exists near the point (not one
 * combined "best" guess), so requesting `poi,neighborhood,place` in a single
 * call gets the venue-name candidate and the generalized-area candidate in one
 * round trip — the label decision below just picks between features already
 * in hand, rather than making a second network call to decide it needs one.
 *
 * That is only true when `limit` is left off. This request used to send
 * `limit=1`, which caps the response at one feature *in total* and so
 * contradicted the paragraph above: `chooseLabel`'s "POI beats the generalized
 * label" rule can only choose between candidates it was actually sent, and its
 * `"neighborhood, city"` fallback needs two features to build a comma. Removed
 * 2026-08-15. Mapbox's own default for reverse geocoding is the one-per-type
 * behaviour this wants, so the correct request is the one that says nothing.
 *
 * TWO THINGS ABOUT THIS REQUEST THAT NEED A LIVE CHECK, NOT A CODE CHANGE.
 * Flagged here rather than fixed blind, because both turn on facts about the
 * project's Mapbox account that are not in this repository. Whoever has the
 * dashboard should settle them; see the report attached to this commit.
 *
 *  1. `permanent=true` is a **Geocoding v6** parameter. On v5 — the version
 *     this URL targets — permanent storage is a *different endpoint*
 *     (`mapbox.places-permanent`), and the parameter below is not part of v5's
 *     vocabulary. So this code is very likely obtaining results under Mapbox's
 *     *temporary* terms and then storing them in `place_label`, which is the
 *     one thing Q25's provider comparison set out to avoid: storage rights are
 *     why Mapbox was chosen over Google. It may also be why no label ever
 *     arrives, if Mapbox rejects the unknown parameter outright rather than
 *     ignoring it — a 4xx here logs and degrades silently by design.
 *  2. `types=poi` no longer returns anything. Mapbox removed POI data from
 *     Geocoding v5 (and v6), directing POI lookups to the Search Box API. The
 *     venue-name half of §2.4's generalization rule is therefore unreachable
 *     through this API today; every label that does arrive is the
 *     neighborhood/city fallback. `chooseLabel` needs no change for that — it
 *     already degrades in exactly that direction — but §2.4's promise of a
 *     venue name is currently unmet, and closing that gap means a different
 *     Mapbox product, not a different parameter.
 *
 * WHY POI BEATS THE GENERALIZED LABEL WHEN BOTH EXIST. §2.4's judgment call:
 * "store a POI/venue name when the provider returns one; when it only returns
 * a street address, store a coarser label instead." A `poi` match near the
 * exact fix is the venue-name case; falling back to neighborhood+city is the
 * generalization for everything else, including a bare street address, which
 * this module never stores at all — `types` never includes `address`, so a
 * street-level result is not a shape the response can even take.
 */

const MAPBOX_REVERSE_ENDPOINT = "https://api.mapbox.com/geocoding/v5/mapbox.places";

interface MapboxFeature {
  text?: string;
  place_name?: string;
  place_type?: string[];
}

interface MapboxResponse {
  features?: MapboxFeature[];
}

/**
 * Picks the label from a set of Mapbox reverse-geocoding features, per §2.4's
 * generalization rule. Pure and unit-tested on its own — the only part of
 * this module with a decision worth testing independently of a real HTTP call.
 */
export function chooseLabel(features: MapboxFeature[]): string | null {
  const poi = features.find((f) => f.place_type?.includes("poi") && f.text);
  if (poi?.text) {
    return poi.text;
  }

  const neighborhood = features.find((f) => f.place_type?.includes("neighborhood"));
  const place = features.find((f) => f.place_type?.includes("place"));

  const parts = [neighborhood?.text, place?.text].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * The city alone, for `meeting_locations.city_label` and the profile's
 * "cities met people in" band (`DESIGN.md` §3, unblocked 2026-08-28).
 *
 * WHY THIS IS A SEPARATE FUNCTION RATHER THAN A SPLIT OF `chooseLabel`'s
 * RESULT. `chooseLabel` returns the most specific thing available, which for
 * any venue is a bare POI name — "Moscone Center", with no city in it at all.
 * Parsing a city back out of that string would silently yield nothing for
 * exactly the venues this is most wanted for, and would yield a
 * *neighbourhood* ("SoMa") for the fallback shape. Mapbox returns the `place`
 * feature separately in the same response, so this reads what the geocoder
 * actually said instead of inferring it.
 *
 * `place` is Mapbox's own type for a city or town. Nothing coarser is
 * accepted: `region` (a state) and `country` are real features in the same
 * response, and counting those as cities would make the band read "3 cities"
 * for three meetings in three different parts of one state.
 */
export function chooseCity(features: MapboxFeature[]): string | null {
  const place = features.find((f) => f.place_type?.includes("place"));
  const text = place?.text;
  return typeof text === "string" && text.trim() !== "" ? text : null;
}

/** What one reverse-geocode yields: the display label, and the city, independently. */
export interface ReverseGeocodeResult {
  label: string | null;
  city: string | null;
}

async function reverseGeocode(
  latitude: number,
  longitude: number,
  accessToken: string,
): Promise<ReverseGeocodeResult> {
  const url = new URL(`${MAPBOX_REVERSE_ENDPOINT}/${longitude},${latitude}.json`);
  url.searchParams.set("types", "poi,neighborhood,place");
  // No `limit`. See the header: Mapbox's default for reverse geocoding is one
  // feature per requested type, which is the whole reason all three types go
  // in one call. `limit=1` would collapse that to a single feature and leave
  // `chooseLabel` nothing to choose between.
  url.searchParams.set("permanent", "true");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString(), {
    // Bounded so a slow vendor cannot hold the already-committed redeem
    // response open indefinitely — this is awaited by the caller (Vercel
    // serverless functions can freeze once a response is sent, so an
    // un-awaited call after `return` is not guaranteed to finish), but it
    // must stay short since the caller's HTTP response is waiting on it.
    signal: AbortSignal.timeout(4000),
  });

  if (!response.ok) {
    // The status alone is not diagnosable. Mapbox answers a rejected request
    // with a JSON body naming what it objected to ("Not Authorized - Invalid
    // Token", an unrecognised parameter, a plan that does not include this
    // endpoint), and without it the operator sees a bare 401/403/422 and has
    // to guess. This path is deliberately silent to the user — a failed
    // geocode must never touch a connection that already committed — so the
    // log is the *only* place the reason can surface. §4.5's warning about
    // silent breakage applies here too.
    //
    // The URL is never logged: it carries the access token in a query
    // parameter. Only the status and the vendor's own message.
    console.error("[geocode] Mapbox reverse geocoding returned an error status", {
      status: response.status,
      detail: (await readErrorDetail(response)) ?? "no body",
    });
    return { label: null, city: null };
  }

  const payload = (await response.json()) as MapboxResponse;
  const features = payload.features ?? [];
  return { label: chooseLabel(features), city: chooseCity(features) };
}

/**
 * The vendor's stated reason for a rejection, truncated and never allowed to
 * throw — reading a body is best-effort diagnostics, and a failure to read one
 * must not become a second, louder failure inside a path whose contract is to
 * degrade quietly.
 */
async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const body = (await response.text()).trim();
    return body === "" ? null : body.slice(0, 300);
  } catch {
    return null;
  }
}

/**
 * Reverse-geocodes one meeting's captured fix and writes the result to
 * `meeting_locations.place_label` and `.city_label`. Never throws — every
 * failure path is logged and swallowed, matching `sendCardTapNotification`'s
 * contract.
 *
 * `city_label` was added 2026-08-28 (20260828170000) so `DESIGN.md` §3's
 * "cities met people in" band could finally be drawn from a real city rather
 * than from `place_label`, which is a venue or neighbourhood name — see
 * `chooseCity` for why the two cannot be the same column.
 *
 * Service-role only: `meeting_locations` has no client UPDATE policy at all
 * (§3.2) — rows are written by the verification service alone, and this is
 * the second and last thing that writes to them after the initial insert.
 */
export async function geocodeMeetingLocation(
  meetingId: string,
  latitude: number,
  longitude: number,
  client: SupabaseClient = serviceRoleClient(),
): Promise<void> {
  try {
    const accessToken = geocodingApiKey();
    if (accessToken === null) {
      // Expected in any environment that hasn't set GEOCODING_API_KEY yet —
      // logged for the same reason push.ts logs a missing Expo token: "no
      // credential" and "broken" look identical from outside unless this
      // line exists.
      console.info("[geocode] GEOCODING_API_KEY is not set; place_label left null", { meetingId });
      return;
    }

    const { label, city } = await reverseGeocode(latitude, longitude, accessToken);

    // Both null means the response carried nothing usable. Writing an UPDATE
    // that sets two nulls over two nulls is a wasted round trip.
    if (label === null && city === null) {
      console.info("[geocode] no usable Mapbox result; place_label and city_label left null", {
        meetingId,
      });
      return;
    }

    // Each column is written only when its own value was actually found.
    // Building the patch this way rather than always sending both means a
    // response that yielded a city but no venue name (the common case today —
    // see the header's note that Mapbox v5 no longer returns POI data) does
    // not overwrite an existing `place_label` with null.
    const patch: { place_label?: string; city_label?: string } = {};
    if (label !== null) patch.place_label = label;
    if (city !== null) patch.city_label = city;

    const { error } = await client
      .from("meeting_locations")
      .update(patch)
      .eq("meeting_id", meetingId);

    if (error) {
      console.error("[geocode] failed to write the geocoded labels", {
        meetingId,
        message: error.message,
      });
    }
  } catch (error) {
    // Catch-all, same contract as push.ts: never propagate, always log.
    console.error("[geocode] reverse geocoding failed", {
      meetingId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
