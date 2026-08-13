import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "./__tests__/fake-store";
import {
  CONNECT_CONFIG_KEYS,
  ConfigurationError,
  MIN_RELAXED_RADIUS_TO_ACCURACY_RATIO,
  parseVerificationConfig,
} from "./config";

/**
 * Configuration is where a security threshold can be turned off by accident,
 * at speed, during an event, by someone editing a row. These tests cover the
 * two ways that goes wrong: a value that is missing or unusable (which must
 * refuse rather than default), and a pair of values that are individually
 * plausible but jointly meaningless.
 */

function rows(over: Record<string, unknown> = {}) {
  const merged: Record<string, unknown> = { ...DEFAULT_CONFIG, ...over };
  return Object.entries(merged).map(([key, value]) => ({ key, value }));
}

describe("parseVerificationConfig", () => {
  it("parses the values the migrations actually seeded", () => {
    expect(parseVerificationConfig(rows())).toEqual(DEFAULT_CONFIG);
  });

  it.each(CONNECT_CONFIG_KEYS)("throws when %s is missing rather than defaulting", (key) => {
    const withoutKey = rows().filter((row) => row.key !== key);
    expect(() => parseVerificationConfig(withoutKey)).toThrow(ConfigurationError);
    expect(() => parseVerificationConfig(withoutKey)).toThrow(new RegExp(key));
  });

  it("throws when a threshold is null, rather than reading it as no limit", () => {
    expect(() => parseVerificationConfig(rows({ qr_max_distance_m: null }))).toThrow(
      ConfigurationError,
    );
  });

  it.each([
    ["a string", "150"],
    ["negative", -1],
    ["zero", 0],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("throws when the radius is %s", (_label, value) => {
    // The specific danger with NaN: every comparison against it is false, so a
    // NaN radius that reached the gate would make `distance > radius` false and
    // accept every scan on earth.
    expect(() => parseVerificationConfig(rows({ qr_max_distance_m: value }))).toThrow(
      ConfigurationError,
    );
  });

  it("throws when the relaxation master switch is not a boolean", () => {
    expect(() => parseVerificationConfig(rows({ qr_relaxation_enabled: "true" }))).toThrow(
      ConfigurationError,
    );
  });
});

describe("the relaxed radius : relaxed accuracy ratio (§4.3 amendment, property 3)", () => {
  it("accepts the seeded 500 m against a 150 m floor", () => {
    expect(parseVerificationConfig(rows()).qr_relaxed_max_distance_m).toBe(500);
  });

  it("refuses a configuration where the accuracy floor has crept toward the radius", () => {
    // The failure this prevents is silent and total: if the floor approaches the
    // radius, the proximity check is satisfiable by imprecision alone — a device
    // reporting "somewhere within 400 m of here" passes a 500 m radius — and it
    // stops meaning anything, with no error anywhere. Refusing the config
    // disables connecting, which is a visible outage someone fixes in a minute.
    expect(() => parseVerificationConfig(rows({ qr_relaxed_max_accuracy_m: 400 }))).toThrow(
      /at least 3x/i,
    );
  });

  it("refuses a configuration where the radius was tightened without the floor", () => {
    expect(() => parseVerificationConfig(rows({ qr_relaxed_max_distance_m: 200 }))).toThrow(
      ConfigurationError,
    );
  });

  it("accepts exactly at the ratio boundary", () => {
    const atBoundary = rows({
      qr_relaxed_max_distance_m: 150 * MIN_RELAXED_RADIUS_TO_ACCURACY_RATIO,
      qr_relaxed_max_accuracy_m: 150,
    });
    expect(() => parseVerificationConfig(atBoundary)).not.toThrow();
  });
});
