/**
 * The GPS proximity gate (§4.3), as pure functions.
 *
 * THIS IS THE SINGLE MOST IMPORTANT DECISION IN THE PRODUCT'S SECURITY MODEL.
 * §4.7 threat 2 (a live video relay — a friend on FaceTime scanning the code
 * off your screen) is not defeated by rotation, because the code the remote
 * person is looking at is genuinely current. It is defeated only by the server
 * comparing two positions the two devices reported independently. Everything in
 * this file exists for that one attack.
 *
 * WHY IT IS SPLIT FROM THE I/O THAT FEEDS IT
 * `evaluateGpsGate` takes already-fetched values and returns a verdict. No
 * database, no clock, no network. That is what makes it possible to test every
 * row of §4.3's fail-closed table exhaustively — each of which must REJECT —
 * without standing up a database per case. A gate whose failure modes are hard
 * to test is a gate whose failure modes are untested.
 *
 * FAIL CLOSED, IN THE PRECISE SENSE §4.3'S TABLE MEANS IT
 * Every situation in that table rejects: permission denied, no fix, fields
 * missing from the request, presenter heartbeat stale, accuracy worse than the
 * threshold, and "any error inside the GPS check". The code below has no branch
 * that returns `ok: true` without having computed a real distance from two real
 * fixes and compared it against a real radius.
 */

import { haversineDistanceM, isUsableCoordinate } from "../geo/haversine";
import type { RejectionReason } from "./rejection-reasons";
import type { GpsFix } from "./verification";

export interface GpsGateThresholds {
  /** `qr_max_distance_m`, or `qr_relaxed_max_distance_m` when relaxation fired. */
  maxDistanceM: number;
  /** `qr_max_accuracy_m`, or `qr_relaxed_max_accuracy_m` when relaxation fired. */
  maxAccuracyM: number;
  /**
   * `presenter_location_max_age_seconds` (90s).
   *
   * JUDGMENT CALL, recorded rather than glossed: §4.3 gives an explicit number
   * for presenter freshness and says only "scanner freshness within tolerance"
   * for the scanner, and §2.5's config table has no second key. Rather than
   * invent an unspecified threshold — which would be a silent deviation, and
   * would put a security number in a place no operator can tune — the same
   * bound is applied to both sides. It is conservative in the right direction:
   * the scanner's fix is captured at the moment of the scan and posted
   * immediately, so 90s is far more slack than a genuine scan needs, and
   * tightening it is the first knob to reach for if pilot data ever suggests a
   * relay is getting through on a stale scanner fix.
   */
  maxLocationAgeSeconds: number;
}

export interface GpsGateInput {
  /** The presenter's last heartbeat position, from `connection_sessions`. Null if none ever landed. */
  presenter: GpsFix | null;
  /** The fix the scanner sent with this request. Null if absent, denied, or unusable. */
  scanner: GpsFix | null;
  now: Date;
  thresholds: GpsGateThresholds;
}

export type GpsGateVerdict =
  | { ok: true; distanceM: number }
  | { ok: false; reason: RejectionReason; distanceM: number | null };

/**
 * A fix claiming to have been captured in the future is refused rather than
 * treated as maximally fresh.
 *
 * Not in §4.3's table, and added deliberately. Freshness is measured as
 * `now - capturedAt`, so a `capturedAt` set forward by an hour produces a
 * negative age that passes every staleness check for the next hour. A client
 * that can set its own timestamp can therefore opt out of the freshness bound
 * entirely — which is the bound §4.7 threat 2 depends on. A small tolerance
 * absorbs ordinary clock skew between a phone and our server; beyond it, the
 * value is not a fix we can reason about.
 */
export const CLOCK_SKEW_TOLERANCE_SECONDS = 30;

function ageSeconds(now: Date, capturedAt: Date): number {
  return (now.getTime() - capturedAt.getTime()) / 1000;
}

function isUsableFix(fix: GpsFix | null): fix is GpsFix {
  return (
    fix !== null &&
    isUsableCoordinate(fix) &&
    Number.isFinite(fix.accuracyM) &&
    fix.accuracyM >= 0 &&
    fix.capturedAt instanceof Date &&
    Number.isFinite(fix.capturedAt.getTime())
  );
}

/**
 * §4.3's five checks, in §4.3's order:
 *   1. presenter freshness
 *   2. scanner freshness
 *   3. accuracy floor — either reading worse than the floor rejects
 *   4. haversine distance, computed server-side
 *   5. compare against the radius in force
 *
 * The order matters less here than it does in §4.2 step 5 (nothing below
 * touches the database or interprets attacker-controlled structure), but it is
 * preserved so that the rejection reason recorded in `connection_attempts` is
 * the same one §4.3 would name — which is what makes the pilot dataset
 * comparable to the design it came from.
 */
export function evaluateGpsGate(input: GpsGateInput): GpsGateVerdict {
  const { presenter, scanner, now, thresholds } = input;

  // Presence first. "Location fields missing from request" and "GPS unavailable
  // / no fix" are two separate rows of §4.3's table and both reject; they are
  // distinguished here only so the audit log can tell them apart, never so the
  // user can.
  if (!isUsableFix(presenter)) {
    return { ok: false, reason: "presenter_location_missing", distanceM: null };
  }
  if (!isUsableFix(scanner)) {
    return { ok: false, reason: "scanner_location_missing", distanceM: null };
  }

  // 1. Presenter freshness. This is the bound that stops a stale fix standing
  //    in for a live one during a relay: the presenter's phone must have been
  //    reporting from where it is *now*, not from where it was.
  const presenterAge = ageSeconds(now, presenter.capturedAt);
  if (presenterAge < -CLOCK_SKEW_TOLERANCE_SECONDS) {
    return { ok: false, reason: "presenter_location_stale", distanceM: null };
  }
  if (presenterAge > thresholds.maxLocationAgeSeconds) {
    return { ok: false, reason: "presenter_location_stale", distanceM: null };
  }

  // 2. Scanner freshness. Same treatment, same bound — see the judgment call on
  //    `maxLocationAgeSeconds`.
  const scannerAge = ageSeconds(now, scanner.capturedAt);
  if (scannerAge < -CLOCK_SKEW_TOLERANCE_SECONDS) {
    return { ok: false, reason: "scanner_location_stale", distanceM: null };
  }
  if (scannerAge > thresholds.maxLocationAgeSeconds) {
    return { ok: false, reason: "scanner_location_stale", distanceM: null };
  }

  // 3. Accuracy floor, both sides. Without it a device could report a
  //    deliberately vague fix — "somewhere within 5km of here" — whose reported
  //    centre happens to sit inside the radius. The floor is what makes the
  //    distance comparison mean something (§4.7 threat 2).
  if (scanner.accuracyM > thresholds.maxAccuracyM) {
    return { ok: false, reason: "scanner_accuracy_too_low", distanceM: null };
  }
  if (presenter.accuracyM > thresholds.maxAccuracyM) {
    return { ok: false, reason: "presenter_accuracy_too_low", distanceM: null };
  }

  // 4. Distance, computed here, on our server, from two independently reported
  //    positions. Never from a number either device sent.
  const distanceM = haversineDistanceM(presenter, scanner);
  if (distanceM === null || !Number.isFinite(distanceM)) {
    // "Any error inside the GPS check" -> reject (§4.3's table, last row).
    return { ok: false, reason: "gps_check_failed", distanceM: null };
  }

  // 5. Compare. Written as `!(distance <= radius)` rather than the more natural
  //    `distance > radius`, and this is not style. Every comparison against NaN
  //    is false, so `NaN > radius` reads as "inside the radius" and the gate
  //    would open on a NaN that got past the guard above. `!(NaN <= radius)` is
  //    true and rejects. On the one comparison that decides whether two people
  //    were in the same place, the expression should not have a value of
  //    `distanceM` for which it silently accepts.
  if (!(distanceM <= thresholds.maxDistanceM)) {
    return { ok: false, reason: "too_far", distanceM };
  }

  return { ok: true, distanceM };
}
