import { describe, expect, it } from "vitest";

import { haversineDistanceM, isUsableCoordinate } from "./haversine";

/**
 * Distance is the input to the single comparison that decides whether two
 * people were in the same place (§4.7 threat 2). These tests check it against
 * coordinate pairs whose true separation is known independently, and — at least
 * as importantly — check that bad input produces `null` rather than a number.
 *
 * The null cases are the security-relevant half. `NaN > radius` is `false`, so
 * a NaN distance flowing into a naive comparison reads as "inside the radius"
 * and the gate opens.
 */

const TIMES_SQUARE = { latitude: 40.758, longitude: -73.9855 };
const EMPIRE_STATE = { latitude: 40.7484, longitude: -73.9857 };
/** Great-circle separation ≈ 1,068 m (geodesic ≈ 1,070 m). */

describe("haversineDistanceM", () => {
  it("returns 0 for a point against itself", () => {
    expect(haversineDistanceM(TIMES_SQUARE, TIMES_SQUARE)).toBe(0);
  });

  it("matches a known short urban distance to within the formula's error budget", () => {
    const distance = haversineDistanceM(TIMES_SQUARE, EMPIRE_STATE);
    expect(distance).not.toBeNull();
    // ~1,068m. The tolerance is 15m, far tighter than the 0.5% spherical-model
    // error and far tighter still than the 100m accuracy floor the gate applies
    // to its inputs — which is the whole reason haversine is precise enough.
    expect(distance as number).toBeGreaterThan(1053);
    expect(distance as number).toBeLessThan(1083);
  });

  it("matches a known long-haul distance (LHR to JFK, ≈5,555 km great-circle)", () => {
    const lhr = { latitude: 51.47, longitude: -0.4543 };
    const jfk = { latitude: 40.6413, longitude: -73.7781 };
    const distance = haversineDistanceM(lhr, jfk) as number;
    expect(distance / 1000).toBeGreaterThan(5540);
    expect(distance / 1000).toBeLessThan(5570);
  });

  it("is symmetric", () => {
    expect(haversineDistanceM(TIMES_SQUARE, EMPIRE_STATE)).toBeCloseTo(
      haversineDistanceM(EMPIRE_STATE, TIMES_SQUARE) as number,
      9,
    );
  });

  it("handles the antipodal case without producing NaN", () => {
    // sqrt(h) can round to a hair over 1 here; the clamp in the implementation
    // is what stops asin() returning NaN — which the gate would have to treat
    // as an error, and which a less careful gate would treat as "close".
    const distance = haversineDistanceM(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 180 },
    ) as number;
    expect(Number.isFinite(distance)).toBe(true);
    expect(distance / 1000).toBeGreaterThan(20_000);
  });

  it("crosses the antimeridian correctly rather than going the long way round", () => {
    const distance = haversineDistanceM(
      { latitude: 0, longitude: 179.99 },
      { latitude: 0, longitude: -179.99 },
    ) as number;
    // ~2.2km, not ~40,000km.
    expect(distance).toBeLessThan(3000);
  });

  it.each([
    ["NaN latitude", { latitude: Number.NaN, longitude: 0 }],
    ["Infinity longitude", { latitude: 0, longitude: Number.POSITIVE_INFINITY }],
    ["latitude out of range", { latitude: 91, longitude: 0 }],
    ["longitude out of range", { latitude: 0, longitude: 181 }],
  ])("returns null for %s rather than a number", (_label, bad) => {
    expect(haversineDistanceM(bad, TIMES_SQUARE)).toBeNull();
    expect(haversineDistanceM(TIMES_SQUARE, bad)).toBeNull();
  });
});

describe("isUsableCoordinate", () => {
  it("rejects null and undefined", () => {
    expect(isUsableCoordinate(null)).toBe(false);
    expect(isUsableCoordinate(undefined)).toBe(false);
  });

  it("accepts the exact range boundaries, which are legal coordinates", () => {
    expect(isUsableCoordinate({ latitude: -90, longitude: -180 })).toBe(true);
    expect(isUsableCoordinate({ latitude: 90, longitude: 180 })).toBe(true);
  });
});
