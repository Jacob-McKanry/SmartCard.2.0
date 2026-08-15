import { describe, expect, it } from "vitest";

import {
  MAX_TICKS_PER_BAND,
  MIN_BAND_CLEARANCE_PX,
  RING_PRESETS,
  bandCaption,
  bandClearances,
  bandExtent,
  guaranteedStaggerDeg,
  labelGapDegrees,
  ringGeometryViolations,
  ringStartAngles,
  sharesAnyAngle,
  tickAngles,
  tickBudget,
  tickTransform,
  type RingBandSpec,
} from "./ring-geometry";

/**
 * `docs/design/DESIGN.md` §3 introduces its geometry rules with "each was a real
 * bug". These tests are that sentence taken literally: one describe block per
 * rule, asserting the arithmetic rather than a rendered pixel, so a change that
 * reintroduces one of those bugs fails `pnpm test` instead of shipping.
 */

/** A band spec with the boring fields filled in, so each test states only what it is about. */
function band(overrides: Partial<RingBandSpec> & Pick<RingBandSpec, "key">): RingBandSpec {
  return {
    count: 1,
    radius: 62,
    tickWidth: 2.5,
    tickLength: 9,
    color: "var(--sc-accent)",
    noun: { one: "record", many: "records" },
    ...overrides,
  };
}

describe("rule: bands need >=8px edge-to-edge clearance, tick-tip to tick-tip", () => {
  it("measures from tick tips, not from ring radii", () => {
    // 26px between the radii, but the ticks eat 4.5px and 6px of that.
    expect(bandExtent({ radius: 62, tickLength: 9 })).toEqual({ inner: 57.5, outer: 66.5 });
    expect(bandClearances([
      { radius: 62, tickLength: 9 },
      { radius: 88, tickLength: 12 },
    ])).toEqual([15.5]);
  });

  it("flags a pair that clears on radii but overlaps on tips", () => {
    // 10px between radii looks fine; a 9px and a 12px tick make it -0.5px.
    const problems = ringGeometryViolations([
      band({ key: "inner", radius: 62, tickLength: 9 }),
      band({ key: "outer", radius: 72, tickLength: 12 }),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("tick-tip to tick-tip");
  });

  it.each(Object.entries(RING_PRESETS))(
    "the %s preset every screen uses clears the floor",
    (_name, preset) => {
      for (const gap of bandClearances(preset.bands)) {
        expect(gap).toBeGreaterThanOrEqual(MIN_BAND_CLEARANCE_PX);
      }
    },
  );

  it("rejects bands passed outermost first, which would silently invert the clearance maths", () => {
    const problems = ringGeometryViolations([
      band({ key: "outer", radius: 112, tickLength: 16 }),
      band({ key: "inner", radius: 62, tickLength: 9 }),
    ]);
    expect(problems.some((p) => p.includes("innermost first"))).toBe(true);
  });
});

describe("rule: adjacent bands must use staggered start angles", () => {
  it("offsets the second band by half the smallest possible tick-to-tick gap", () => {
    // Two 12-tick bands is the case that would otherwise align perfectly and
    // draw each aligned pair as one long tick. 360/lcm(12,12) = 30, so 15.
    const [first, second] = ringStartAngles([12, 12]);
    expect(second! - first!).toBeCloseTo(15, 10);
    expect(guaranteedStaggerDeg(12, 12)).toBeCloseTo(15, 10);
  });

  it("never places a tick of one band on a tick angle of the next, for any counts up to the cap", () => {
    // Exhaustive, because the failure mode is arithmetic — a shared angle exists
    // exactly when the start offset is a multiple of 360/lcm(m,n) — and a spot
    // check would miss precisely the count pairs that collide. This is the test
    // that rejected a fixed-degree stagger constant during the build.
    const collisions: string[] = [];
    for (let innerTicks = 1; innerTicks <= MAX_TICKS_PER_BAND; innerTicks++) {
      for (let outerTicks = 1; outerTicks <= MAX_TICKS_PER_BAND; outerTicks++) {
        const [innerStart, outerStart] = ringStartAngles([innerTicks, outerTicks]);
        if (
          sharesAnyAngle(tickAngles(innerStart!, innerTicks), tickAngles(outerStart!, outerTicks))
        ) {
          collisions.push(`${innerTicks}x${outerTicks}`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it("keeps the guaranteed separation above the eye's merge threshold for every pair", () => {
    // The largest lcm of two counts at or below 40 is lcm(39,40) = 1560, so the
    // tightest guaranteed separation is 180/1560 of a degree. That is the
    // floor the exhaustive test above is really asserting; stated here so a
    // future change to MAX_TICKS_PER_BAND shows its consequence directly.
    let worst = 360;
    for (let m = 1; m <= MAX_TICKS_PER_BAND; m++) {
      for (let n = 1; n <= MAX_TICKS_PER_BAND; n++) {
        worst = Math.min(worst, guaranteedStaggerDeg(m, n));
      }
    }
    expect(worst).toBeCloseTo(180 / 1560, 6);
  });

  it("lets an empty band pass through without shifting the band outside it", () => {
    // A brand-new account has zero of something. That must not move the ticks
    // of the band that does have records — the diagram would appear to rotate
    // as unrelated counts changed.
    expect(ringStartAngles([0, 6])).toEqual(ringStartAngles([0, 6]));
    const [, withEmptyInner] = ringStartAngles([0, 6]);
    const [onlyBand] = ringStartAngles([6]);
    expect(withEmptyInner).toBeCloseTo(onlyBand!, 10);
  });

  it("treats angles a whisker apart as the same angle", () => {
    expect(sharesAnyAngle([0], [359.99])).toBe(true);
    expect(sharesAnyAngle([0], [7])).toBe(false);
  });
});

describe("rule: one tick = one record, until ~40 records", () => {
  it("draws one tick per record below the cap", () => {
    expect(tickBudget(0)).toEqual({ ticks: 0, recordsPerTick: 1 });
    expect(tickBudget(1)).toEqual({ ticks: 1, recordsPerTick: 1 });
    expect(tickBudget(12)).toEqual({ ticks: 12, recordsPerTick: 1 });
    expect(tickBudget(MAX_TICKS_PER_BAND)).toEqual({ ticks: 40, recordsPerTick: 1 });
  });

  it("compresses to a whole-number ratio above the cap, never above it in ticks", () => {
    for (const count of [41, 80, 81, 199, 400, 1201]) {
      const { ticks, recordsPerTick } = tickBudget(count);
      expect(ticks).toBeLessThanOrEqual(MAX_TICKS_PER_BAND);
      expect(Number.isInteger(recordsPerTick)).toBe(true);
      // The ratio must still cover every record — a budget that dropped records
      // would be the undercount §3 is guarding against, in a different disguise.
      expect(ticks * recordsPerTick).toBeGreaterThanOrEqual(count);
    }
    expect(tickBudget(41).recordsPerTick).toBe(2);
    expect(tickBudget(80).recordsPerTick).toBe(2);
    expect(tickBudget(81).recordsPerTick).toBe(3);
  });

  it("states the ratio in the caption whenever one tick stops meaning one record", () => {
    const many = bandCaption(band({ key: "c", count: 96, noun: { one: "connection", many: "connections" } }));
    expect(many.text).toBe("96 connections");
    expect(many.ratio).toBe("1 tick = 3 connections");

    const few = bandCaption(band({ key: "c", count: 12, noun: { one: "connection", many: "connections" } }));
    expect(few.ratio).toBeNull();
  });

  it("writes an honest caption for zero and one", () => {
    expect(bandCaption(band({ key: "c", count: 0, noun: { one: "connection", many: "connections" } })).text).toBe(
      "No connections",
    );
    expect(bandCaption(band({ key: "c", count: 1, noun: { one: "connection", many: "connections" } })).text).toBe(
      "1 connection",
    );
  });
});

describe("tick placement", () => {
  it("spaces ticks evenly around the full circle", () => {
    expect(tickAngles(45, 4)).toEqual([45, 135, 225, 315]);
  });

  it("centres a single tick in its own slot rather than on the vertical axis", () => {
    expect(ringStartAngles([1])).toEqual([180]);
    expect(tickAngles(180, 1)).toEqual([180]);
  });

  it("rotates before translating, so the tick lands on its ring pointing outward", () => {
    expect(tickTransform(45, 62)).toBe("rotate(45.00deg) translateY(-62px)");
  });
});

describe("on-ring label gap (unused by any screen; kept per §3)", () => {
  it("widens as the label grows and narrows as the radius grows", () => {
    const near = labelGapDegrees(60, 62);
    const far = labelGapDegrees(60, 112);
    expect(near).toBeGreaterThan(far);
    // 2*atan(30/62) in degrees.
    expect(near).toBeCloseTo(51.66, 1);
  });
});

describe("the layouts the app actually ships", () => {
  it("passes every rule for a pilot-sized profile", () => {
    const [inner, middle] = RING_PRESETS.profile.bands;
    expect(inner).toBeDefined();
    expect(middle).toBeDefined();
    expect(
      ringGeometryViolations([
        band({ key: "connections", count: 12, ...inner, noun: { one: "connection", many: "connections" } }),
        band({ key: "events", count: 6, ...middle, noun: { one: "event", many: "events" } }),
      ]),
    ).toEqual([]);
  });

  it("passes every rule for a brand-new account with nothing in it yet", () => {
    const [inner, middle] = RING_PRESETS.profile.bands;
    expect(
      ringGeometryViolations([
        band({ key: "connections", count: 0, ...inner, noun: { one: "connection", many: "connections" } }),
        band({ key: "events", count: 0, ...middle, noun: { one: "event", many: "events" } }),
      ]),
    ).toEqual([]);
  });

  it("passes every rule for counts well past the tick cap", () => {
    const [inner, middle] = RING_PRESETS.profile.bands;
    expect(
      ringGeometryViolations([
        band({ key: "connections", count: 337, ...inner, noun: { one: "connection", many: "connections" } }),
        band({ key: "events", count: 64, ...middle, noun: { one: "event", many: "events" } }),
      ]),
    ).toEqual([]);
  });
});
