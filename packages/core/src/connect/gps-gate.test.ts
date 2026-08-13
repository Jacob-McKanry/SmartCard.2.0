import { describe, expect, it } from "vitest";

import { CLOCK_SKEW_TOLERANCE_SECONDS, evaluateGpsGate, type GpsGateThresholds } from "./gps-gate";
import type { GpsFix } from "./verification";

/**
 * §4.3's fail-closed table, every row, as an executable checklist.
 *
 *   | Situation                          | Behaviour |
 *   | Location permission denied         | Reject    |
 *   | GPS unavailable / no fix           | Reject    |
 *   | Location fields missing from request | Reject  |
 *   | Presenter heartbeat stale          | Reject    |
 *   | Accuracy worse than threshold      | Reject    |
 *   | Any error inside the GPS check     | Reject    |
 *
 * The project brief for this build is explicit that a passing happy-path test
 * proves nothing about security. The happy path appears here exactly once, as
 * the control that shows the other cases fail for the reason claimed rather
 * than because the fixture was broken.
 */

const NOW = new Date("2026-08-13T18:00:00.000Z");

const THRESHOLDS: GpsGateThresholds = {
  maxDistanceM: 150,
  maxAccuracyM: 100,
  maxLocationAgeSeconds: 90,
};

/** Two points ~55 m apart in midtown Manhattan — comfortably inside 150 m. */
const PRESENTER_POINT = { latitude: 40.758, longitude: -73.9855 };
const NEARBY_POINT = { latitude: 40.75845, longitude: -73.98577 };
/** ~2.1 km away: the same city, nowhere near the same room. */
const ACROSS_TOWN = { latitude: 40.7391, longitude: -73.9903 };

function fix(point: { latitude: number; longitude: number }, over: Partial<GpsFix> = {}): GpsFix {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyM: 12,
    capturedAt: NOW,
    ...over,
  };
}

function run(presenter: GpsFix | null, scanner: GpsFix | null, thresholds = THRESHOLDS) {
  return evaluateGpsGate({ presenter, scanner, now: NOW, thresholds });
}

describe("evaluateGpsGate — the one accepting case", () => {
  it("accepts two fresh, precise fixes inside the radius and reports the distance", () => {
    const verdict = run(fix(PRESENTER_POINT), fix(NEARBY_POINT));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.distanceM).toBeGreaterThan(0);
      expect(verdict.distanceM).toBeLessThan(150);
    }
  });
});

describe("evaluateGpsGate — §4.3's fail-closed table", () => {
  it("rejects when the scanner sent no location at all (permission denied / no fix)", () => {
    const verdict = run(fix(PRESENTER_POINT), null);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("scanner_location_missing");
  });

  it("rejects when the presenter has never posted a heartbeat", () => {
    const verdict = run(null, fix(NEARBY_POINT));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("presenter_location_missing");
  });

  it.each([
    ["latitude", { latitude: Number.NaN }],
    ["longitude", { longitude: Number.POSITIVE_INFINITY }],
    ["accuracy", { accuracyM: Number.NaN }],
    ["timestamp", { capturedAt: new Date(Number.NaN) }],
  ])("rejects a scanner fix with an unusable %s", (_label, broken) => {
    const verdict = run(fix(PRESENTER_POINT), fix(NEARBY_POINT, broken as Partial<GpsFix>));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("scanner_location_missing");
  });

  it("rejects when the presenter's heartbeat is older than the freshness bound", () => {
    const stale = fix(PRESENTER_POINT, { capturedAt: new Date(NOW.getTime() - 91_000) });
    const verdict = run(stale, fix(NEARBY_POINT));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("presenter_location_stale");
  });

  it("accepts a heartbeat exactly at the bound, and rejects one a second past it", () => {
    const atBound = fix(PRESENTER_POINT, { capturedAt: new Date(NOW.getTime() - 90_000) });
    expect(run(atBound, fix(NEARBY_POINT)).ok).toBe(true);

    const pastBound = fix(PRESENTER_POINT, { capturedAt: new Date(NOW.getTime() - 90_001) });
    expect(run(pastBound, fix(NEARBY_POINT)).ok).toBe(false);
  });

  it("rejects a stale scanner fix, not only a stale presenter one", () => {
    const verdict = run(
      fix(PRESENTER_POINT),
      fix(NEARBY_POINT, { capturedAt: new Date(NOW.getTime() - 120_000) }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("scanner_location_stale");
  });

  it("rejects a fix timestamped in the future rather than treating it as maximally fresh", () => {
    // The attack: freshness is `now - capturedAt`, so a timestamp set forward by
    // an hour produces a negative age that passes every staleness check for the
    // next hour — i.e. a client that can set its own clock opts out of the bound
    // §4.7 threat 2 depends on.
    const future = fix(NEARBY_POINT, {
      capturedAt: new Date(NOW.getTime() + (CLOCK_SKEW_TOLERANCE_SECONDS + 5) * 1000),
    });
    const verdict = run(fix(PRESENTER_POINT), future);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("scanner_location_stale");
  });

  it("tolerates ordinary clock skew, so a slightly-fast phone still works", () => {
    const slightlyAhead = fix(NEARBY_POINT, {
      capturedAt: new Date(NOW.getTime() + (CLOCK_SKEW_TOLERANCE_SECONDS - 5) * 1000),
    });
    expect(run(fix(PRESENTER_POINT), slightlyAhead).ok).toBe(true);
  });

  it("rejects a scanner fix worse than the accuracy floor", () => {
    const verdict = run(fix(PRESENTER_POINT), fix(NEARBY_POINT, { accuracyM: 101 }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("scanner_accuracy_too_low");
  });

  it("rejects a presenter fix worse than the accuracy floor", () => {
    const verdict = run(fix(PRESENTER_POINT, { accuracyM: 100.5 }), fix(NEARBY_POINT));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("presenter_accuracy_too_low");
  });

  it("rejects a deliberately vague fix whose reported centre is inside the radius", () => {
    // This is what the accuracy floor exists for (§4.7 threat 2). Without it, a
    // device could report "somewhere within 5 km of here" and satisfy a
    // distance comparison it has no business satisfying.
    const vague = fix(NEARBY_POINT, { accuracyM: 5000 });
    const verdict = run(fix(PRESENTER_POINT), vague);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("scanner_accuracy_too_low");
  });
});

describe("evaluateGpsGate — the distance comparison itself", () => {
  it("rejects a scan from across town and records the distance for the audit log", () => {
    const verdict = run(fix(PRESENTER_POINT), fix(ACROSS_TOWN));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("too_far");
      // The number is computed and kept — it goes to connection_attempts, which
      // no client can read. It must never appear in a response (§4.2 step 7).
      expect(verdict.distanceM).toBeGreaterThan(1500);
    }
  });

  it("accepts at exactly the radius and rejects one metre past it", () => {
    // Constructed rather than measured: 0.001 degrees of latitude is ~111.19 m.
    const presenter = fix({ latitude: 0, longitude: 0 });
    const justInside = fix({ latitude: 0.001, longitude: 0 });
    expect(run(presenter, justInside, { ...THRESHOLDS, maxDistanceM: 112 }).ok).toBe(true);
    expect(run(presenter, justInside, { ...THRESHOLDS, maxDistanceM: 111 }).ok).toBe(false);
  });

  it("applies the relaxed radius when it is handed one, and only then", () => {
    const presenter = fix(PRESENTER_POINT);
    const scanner = fix({ latitude: 40.7601, longitude: -73.9885 }); // ~350 m
    expect(run(presenter, scanner, { ...THRESHOLDS, maxDistanceM: 150 }).ok).toBe(false);
    expect(
      run(presenter, scanner, { maxDistanceM: 500, maxAccuracyM: 150, maxLocationAgeSeconds: 90 })
        .ok,
    ).toBe(true);
  });
});
