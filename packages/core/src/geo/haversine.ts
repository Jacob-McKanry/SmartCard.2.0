/**
 * Great-circle distance between two GPS points (§4.3 check 4).
 *
 * This is deliberately a plain function with no database, no network and no
 * clock: it is the single most-exercised piece of arithmetic in the security
 * model, and it must be testable against known coordinate pairs without any of
 * that. §1.3 puts it in `packages/core` for the same reason.
 *
 * WHY HAVERSINE AND NOT SOMETHING MORE ACCURATE
 * Haversine treats the Earth as a sphere. Vincenty/Karney treat it as the
 * ellipsoid it actually is and are accurate to millimetres, at the cost of an
 * iterative solver. The error haversine carries is up to about 0.5% — around
 * 0.75m over a 150m radius, and about 2.5m over the relaxed 500m one. Both are
 * an order of magnitude smaller than the `qr_max_accuracy_m` floor (100m) that
 * the same check enforces on the inputs, so a more precise formula would be
 * computing a sharper answer from data that is not that sharp. §4.3 names
 * haversine explicitly; this note records that it was checked rather than
 * simply inherited.
 *
 * WHY IT IS COMPUTED SERVER-SIDE AND NOTHING ELSE MATTERS
 * §0's convention: a phone can be modified by its owner, our server cannot. A
 * distance computed on either device is a number an attacker chooses. This
 * function runs only on our server, over two positions each device reported
 * independently — which is the whole of §4.7 threat 2's defence.
 */

const EARTH_RADIUS_M = 6_371_008.8; // IUGG mean radius; the value haversine implementations conventionally use.

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Returns metres, or `null` if either point is not a usable coordinate.
 *
 * Null rather than `NaN` on bad input, and this is a security decision rather
 * than a style one. `NaN > radius` is `false`, so a NaN distance flowing into a
 * naive comparison reads as "inside the radius" and the gate opens. A null
 * cannot be compared by accident — the caller has to handle it, and
 * `evaluateGpsGate` handles it by rejecting.
 */
export function haversineDistanceM(a: LatLng, b: LatLng): number | null {
  if (!isUsableCoordinate(a) || !isUsableCoordinate(b)) {
    return null;
  }

  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);

  const sinHalfDLat = Math.sin(dLat / 2);
  const sinHalfDLng = Math.sin(dLng / 2);

  const h = sinHalfDLat * sinHalfDLat + Math.cos(lat1) * Math.cos(lat2) * sinHalfDLng * sinHalfDLng;

  // Clamping guards the arcsine against a value a hair over 1 from floating
  // point rounding at antipodal distances, which would otherwise produce NaN —
  // the exact value the null-on-bad-input rule above exists to keep out.
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isUsableCoordinate(point: LatLng | null | undefined): point is LatLng {
  if (point === null || point === undefined) return false;
  const { latitude, longitude } = point;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}
