import { describe, expect, it } from "vitest";

import { selectAutoTaggedEvent } from "./event-tagging";
import type { CandidateEventRecord } from "./ports";

/**
 * The geofence half of the §2.6 matching rule, as a pure function.
 *
 * The store's half — both people answered `going`, the event was running, the
 * venue has coordinates — is exercised end-to-end in
 * `__tests__/event-tagging.test.ts`. What is tested here is only what core
 * decides: whether BOTH fixes are inside the geofence, and what happens when
 * more than one event qualifies.
 *
 * Note what is deliberately absent from this file: any assertion about
 * accepting or rejecting a connection. This function cannot do either, and the
 * test that proves it lives with the verifier.
 */

/** Midtown Manhattan. The venue. */
const VENUE = { latitude: 40.758, longitude: -73.9855 };
/** ~55 m from the venue — inside a 150 m geofence. */
const INSIDE = { latitude: 40.75845, longitude: -73.98577 };
/** ~222 m from the venue (0.002° of latitude) — outside it. */
const OUTSIDE = { latitude: 40.76, longitude: -73.9855 };
/** ~2.1 km away. */
const ACROSS_TOWN = { latitude: 40.7391, longitude: -73.9903 };

const RADIUS_M = 150;

function candidate(id: string, at: { latitude: number; longitude: number }): CandidateEventRecord {
  return { id, latitude: at.latitude, longitude: at.longitude };
}

const EVENT_A = candidate("e0000001-0000-4000-8000-000000000001", VENUE);

function select(
  candidates: CandidateEventRecord[],
  presenter: { latitude: number; longitude: number } | null,
  scanner: { latitude: number; longitude: number } | null,
  geofenceRadiusM = RADIUS_M,
) {
  return selectAutoTaggedEvent({ candidates, presenter, scanner, geofenceRadiusM });
}

describe("selectAutoTaggedEvent — the one matching case", () => {
  it("tags when both fixes are inside the geofence", () => {
    expect(select([EVENT_A], VENUE, INSIDE)).toBe(EVENT_A.id);
  });
});

describe("selectAutoTaggedEvent — both fixes, not either", () => {
  it("declines when only the presenter is inside", () => {
    expect(select([EVENT_A], VENUE, OUTSIDE)).toBeNull();
  });

  it("declines when only the scanner is inside", () => {
    expect(select([EVENT_A], OUTSIDE, VENUE)).toBeNull();
  });

  it("declines when neither is inside, even though the two are next to each other", () => {
    // The pair passed the proximity gate — they really did meet. They just did
    // not meet at this event, which is precisely the claim being declined.
    expect(select([EVENT_A], ACROSS_TOWN, ACROSS_TOWN)).toBeNull();
  });

  it("tags at exactly the radius and declines one metre past it", () => {
    // 0.001° of latitude is ~111.19 m. Constructed rather than measured so the
    // boundary is the assertion rather than a coincidence.
    const at = candidate("e0000001-0000-4000-8000-0000000000bb", { latitude: 0, longitude: 0 });
    const justOut = { latitude: 0.001, longitude: 0 };
    expect(select([at], justOut, justOut, 112)).toBe(at.id);
    expect(select([at], justOut, justOut, 111)).toBeNull();
  });
});

describe("selectAutoTaggedEvent — ambiguity declines rather than guesses", () => {
  it("declines when two events both match, even though one is much nearer", () => {
    // A conference with two parallel tracks in one building. Picking the nearer
    // centroid would be picking by how the coordinates were rounded.
    const near = candidate("e0000001-0000-4000-8000-000000000002", VENUE);
    const alsoNear = candidate("e0000001-0000-4000-8000-000000000003", INSIDE);
    expect(select([near, alsoNear], VENUE, INSIDE)).toBeNull();
  });

  it("tags when only one of several candidates actually matches", () => {
    // Ambiguity means two MATCHES, not two candidates. A second event both
    // people are going to, held across town at the same hour, must not suppress
    // the tag for the one they were standing in.
    const here = candidate("e0000001-0000-4000-8000-000000000004", VENUE);
    const elsewhere = candidate("e0000001-0000-4000-8000-000000000005", ACROSS_TOWN);
    expect(select([here, elsewhere], VENUE, INSIDE)).toBe(here.id);
  });

  it("treats the same event returned twice as one match, not as ambiguity", () => {
    expect(select([EVENT_A, { ...EVENT_A }], VENUE, INSIDE)).toBe(EVENT_A.id);
  });

  it("declines on an empty candidate list", () => {
    expect(select([], VENUE, INSIDE)).toBeNull();
  });
});

describe("selectAutoTaggedEvent — unusable inputs decline rather than match", () => {
  it.each([
    ["NaN", Number.NaN],
    ["zero", 0],
    ["negative", -1],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("declines when the geofence radius is %s", (_label, radius) => {
    // NaN is the one that matters. Every comparison against it is false, so a
    // NaN radius reaching the comparison unguarded would make `distance >
    // radius` false and match a single candidate anywhere on earth.
    expect(select([EVENT_A], VENUE, INSIDE, radius)).toBeNull();
  });

  it.each([
    ["latitude", { latitude: Number.NaN, longitude: -73.9855 }],
    ["longitude", { latitude: 40.758, longitude: 999 }],
  ])("skips a candidate with an unusable %s instead of throwing", (_label, broken) => {
    const corrupt = candidate("e0000001-0000-4000-8000-000000000006", broken);
    expect(select([corrupt], VENUE, INSIDE)).toBeNull();
    // And a corrupt row sitting beside a good one does not suppress the good
    // one — it is not a match, so it cannot make the result ambiguous.
    expect(select([corrupt, EVENT_A], VENUE, INSIDE)).toBe(EVENT_A.id);
  });

  it.each([
    ["presenter", null, INSIDE],
    ["scanner", VENUE, null],
    ["both", null, null],
  ])("declines when the %s fix is missing", (_label, presenter, scanner) => {
    expect(select([EVENT_A], presenter, scanner)).toBeNull();
  });
});
