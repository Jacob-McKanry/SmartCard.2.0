import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "./__tests__/fake-store";
import { evaluateRelaxation, thresholdsFor, type RelaxationHistory } from "./relaxation";
import { unlocksRelaxation } from "./rejection-reasons";

/**
 * §4.7 threat 6: "deliberately failing twice to unlock the relaxed radius".
 *
 * The mechanism is knowingly attacker-triggerable — anyone can fail twice on
 * purpose — so what these tests defend is not "nobody can trigger it" but the
 * three bounds that make it survivable (§4.3 amendment):
 *
 *   1. it does not escalate — two rungs, never a third
 *   2. it cools down after use, whatever the outcome of the relaxed attempt
 *   3. the relaxed radius stays far larger than the relaxed accuracy floor
 *      (tested in `config.test.ts`, since it is a property of configuration)
 *
 * plus the eligibility scoping that stops junk requests buying a wider radius.
 */

const NOW = new Date("2026-08-13T18:00:00.000Z");

function history(over: Partial<RelaxationHistory> = {}): RelaxationHistory {
  return {
    unlockingFailuresInWindow: 0,
    mostRecentUnlockingFailureId: null,
    lastRelaxedAttemptAt: null,
    ...over,
  };
}

describe("evaluateRelaxation — when it fires", () => {
  it("does not relax on a first attempt", () => {
    expect(evaluateRelaxation(history(), DEFAULT_CONFIG, NOW).relaxed).toBe(false);
  });

  it("does not relax on one qualifying failure — the threshold is two", () => {
    expect(
      evaluateRelaxation(history({ unlockingFailuresInWindow: 1 }), DEFAULT_CONFIG, NOW).relaxed,
    ).toBe(false);
  });

  it("relaxes on the attempt after two qualifying failures, naming the source failure", () => {
    const decision = evaluateRelaxation(
      history({ unlockingFailuresInWindow: 2, mostRecentUnlockingFailureId: "attempt-1" }),
      DEFAULT_CONFIG,
      NOW,
    );
    expect(decision).toEqual({ relaxed: true, sourceAttemptId: "attempt-1" });
  });

  it("does not relax when the master switch is off", () => {
    const decision = evaluateRelaxation(
      history({ unlockingFailuresInWindow: 5 }),
      { ...DEFAULT_CONFIG, qr_relaxation_enabled: false },
      NOW,
    );
    expect(decision.relaxed).toBe(false);
  });
});

describe("evaluateRelaxation — property 1: it does not escalate", () => {
  it("gives the same relaxed thresholds after two failures as after twenty", () => {
    const twice = thresholdsFor(
      evaluateRelaxation(history({ unlockingFailuresInWindow: 2 }), DEFAULT_CONFIG, NOW),
      DEFAULT_CONFIG,
    );
    const twenty = thresholdsFor(
      evaluateRelaxation(history({ unlockingFailuresInWindow: 20 }), DEFAULT_CONFIG, NOW),
      DEFAULT_CONFIG,
    );
    expect(twice).toEqual(twenty);
    expect(twenty.maxDistanceM).toBe(DEFAULT_CONFIG.qr_relaxed_max_distance_m);
  });

  it("never returns a radius wider than the configured relaxed one, at any failure count", () => {
    // The attack this forecloses: walk the radius up to citywide by being
    // patient, which is the same as having no radius, executed slowly.
    for (const failures of [2, 3, 5, 10, 100, 10_000]) {
      const thresholds = thresholdsFor(
        evaluateRelaxation(history({ unlockingFailuresInWindow: failures }), DEFAULT_CONFIG, NOW),
        DEFAULT_CONFIG,
      );
      expect(thresholds.maxDistanceM).toBeLessThanOrEqual(DEFAULT_CONFIG.qr_relaxed_max_distance_m);
      expect(thresholds.maxAccuracyM).toBeLessThanOrEqual(DEFAULT_CONFIG.qr_relaxed_max_accuracy_m);
    }
  });
});

describe("evaluateRelaxation — property 2: it cools down", () => {
  it("refuses a second relaxation inside the cooldown", () => {
    const decision = evaluateRelaxation(
      history({
        unlockingFailuresInWindow: 10,
        lastRelaxedAttemptAt: new Date(NOW.getTime() - 60 * 1000),
      }),
      DEFAULT_CONFIG,
      NOW,
    );
    expect(decision.relaxed).toBe(false);
  });

  it("still refuses at one second before the cooldown elapses", () => {
    const decision = evaluateRelaxation(
      history({
        unlockingFailuresInWindow: 10,
        lastRelaxedAttemptAt: new Date(NOW.getTime() - 3_599_000),
      }),
      DEFAULT_CONFIG,
      NOW,
    );
    expect(decision.relaxed).toBe(false);
  });

  it("allows relaxation again once the full hour has elapsed", () => {
    const decision = evaluateRelaxation(
      history({
        unlockingFailuresInWindow: 2,
        mostRecentUnlockingFailureId: "attempt-9",
        lastRelaxedAttemptAt: new Date(NOW.getTime() - 3_600_000),
      }),
      DEFAULT_CONFIG,
      NOW,
    );
    expect(decision.relaxed).toBe(true);
  });

  it("refuses when the last relaxed timestamp is unusable, rather than treating it as elapsed", () => {
    // `NaN < cooldown` is false, which would read as "cooldown elapsed" and hand
    // out relaxation on every attempt. The explicit finite check is what stops
    // a corrupt timestamp becoming a permanent relaxation.
    const decision = evaluateRelaxation(
      history({ unlockingFailuresInWindow: 5, lastRelaxedAttemptAt: new Date(Number.NaN) }),
      DEFAULT_CONFIG,
      NOW,
    );
    expect(decision.relaxed).toBe(false);
  });
});

describe("relaxation eligibility is scoped to distance and accuracy failures only", () => {
  it("counts only the three reasons a genuinely-adjacent pair can hit", () => {
    expect(unlocksRelaxation("too_far")).toBe(true);
    expect(unlocksRelaxation("scanner_accuracy_too_low")).toBe(true);
    expect(unlocksRelaxation("presenter_accuracy_too_low")).toBe(true);
  });

  it.each([
    "invalid_signature",
    "malformed_token",
    "token_expired",
    "session_not_found",
    "session_expired",
    "nonce_mismatch",
    "blocked",
    "already_connected",
    "rate_limited",
    "self_connect",
    "scanner_location_missing",
    "presenter_location_stale",
  ] as const)("does not let a %s failure buy a wider radius", (reason) => {
    // Without this scoping an attacker could spend two junk requests — a bad
    // HMAC costs nothing to produce — and be evaluated at 500 m on the third.
    expect(unlocksRelaxation(reason)).toBe(false);
  });
});

describe("thresholdsFor", () => {
  it("returns the normal pair when relaxation did not fire", () => {
    expect(thresholdsFor({ relaxed: false, sourceAttemptId: null }, DEFAULT_CONFIG)).toEqual({
      maxDistanceM: 150,
      maxAccuracyM: 100,
      radiusMode: "normal",
    });
  });

  it("returns the relaxed pair, marked as relaxed for the audit log", () => {
    expect(thresholdsFor({ relaxed: true, sourceAttemptId: "x" }, DEFAULT_CONFIG)).toEqual({
      maxDistanceM: 500,
      maxAccuracyM: 150,
      radiusMode: "relaxed",
    });
  });
});
