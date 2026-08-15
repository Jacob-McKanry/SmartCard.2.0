/**
 * The tick and clearance maths behind the ring diagram (`docs/design/DESIGN.md`
 * §3). Pure arithmetic, no React and no DOM, so the rules §3 calls
 * "non-negotiable" can be unit-tested rather than eyeballed in a browser.
 *
 * WHY THIS IS A SEPARATE MODULE FROM THE COMPONENT
 *
 * §3 records four geometry rules and says of them "each was a real bug". Three
 * of the four are pure arithmetic — band clearance, staggered start angles, and
 * one-tick-per-record — so they are decidable here, at build time, by
 * `ring-geometry.test.ts`. Leaving them inside a JSX file would make them
 * testable only through a rendering environment this app deliberately does not
 * have (see `apps/web/vitest.config.ts`: node only, no jsdom, on purpose).
 *
 * The fourth rule — "if a label must sit on a ring, reserve a gap of
 * 2·atan(labelWidth/2 / radius)" — is implemented as `labelGapDegrees` below but
 * is not used by any screen: §3's own advice is "prefer a caption", and every
 * caller does. It is kept because the arc arithmetic is the part that is easy to
 * get wrong, and a future caller that needs an on-ring label should not have to
 * re-derive it.
 */

/**
 * Minimum edge-to-edge distance between two bands, measured tick-tip to
 * tick-tip — NOT centre-line to centre-line. §3: measuring from the ring radii
 * instead of the tick extents is what produced the original overlap bug, since
 * a 16px tick puts 8px of itself on each side of its own radius.
 */
export const MIN_BAND_CLEARANCE_PX = 8;

/**
 * Above this many records in one band, one tick per record stops being legible
 * and merges into texture (§3). Past it the band draws a reduced number of
 * ticks and the caption states the ratio, so the diagram never silently
 * undercounts.
 */
export const MAX_TICKS_PER_BAND = 40;

/**
 * How far apart, in degrees, two adjacent bands' tick angles are guaranteed to
 * stay. See `ringStartAngles` — this is not a tuning knob, it is the arithmetic
 * best case, and it is here so the test can assert the guarantee by name.
 */
export function guaranteedStaggerDeg(innerTicks: number, outerTicks: number): number {
  if (innerTicks <= 0 || outerTicks <= 0) return 360;
  return 180 / lcm(innerTicks, outerTicks);
}

/** The radial shape of one band, before a caller attaches a count and a meaning. */
export interface BandShape {
  radius: number;
  tickWidth: number;
  tickLength: number;
}

/**
 * The sizes §3 names, as concrete band shapes. Callers pick a preset and supply
 * counts, colours and nouns, so no screen invents its own radii — the clearance
 * arithmetic only has to hold for the handful of layouts listed here, and
 * `ring-geometry.test.ts` checks every one of them.
 *
 * DEVIATION FROM §3, RECORDED HERE AND IN DESIGN.md. §3 lists a third "crest"
 * size as "150px box (r 32/48/66)". Those radii fail §3's own ≥8px clearance
 * rule with the tick lengths §3 specifies (a 9px tick at r32 ends at 36.5, a
 * 12px tick at r48 starts at 42 — 5.5px apart), while the prototype's actual
 * crest renders two bands at r52/r70 with 8px/11px ticks, which clears by 8.5px.
 * The prototype's numbers are the ones below, because they are the ones that
 * satisfy the rule the document itself calls non-negotiable.
 */
export const RING_PRESETS = {
  /** Profile. §3: 256px box, r 62/88/112. */
  profile: {
    box: 256,
    bands: [
      { radius: 62, tickWidth: 2.5, tickLength: 9 },
      { radius: 88, tickWidth: 2.5, tickLength: 12 },
      { radius: 112, tickWidth: 3, tickLength: 16 },
    ],
  },
  /** Meeting-record / connection hero. §3: 220px box, r 62/84/106. */
  hero: {
    box: 220,
    bands: [
      { radius: 62, tickWidth: 2.5, tickLength: 9 },
      { radius: 84, tickWidth: 2.5, tickLength: 12 },
      { radius: 106, tickWidth: 3, tickLength: 15 },
    ],
  },
  /** Crest, e.g. the Connect payoff. See the deviation note above. */
  crest: {
    box: 150,
    bands: [
      { radius: 52, tickWidth: 2, tickLength: 8 },
      { radius: 70, tickWidth: 2.5, tickLength: 11 },
    ],
  },
} as const satisfies Record<string, { box: number; bands: readonly BandShape[] }>;

export type RingPresetName = keyof typeof RING_PRESETS;

/** One band of the diagram, as a caller describes it. */
export interface RingBandSpec {
  /** React key and test handle; also the caption chip's identity. */
  key: string;
  /** How many real records this band represents. Never a rounded or padded number. */
  count: number;
  /** Centre of the band, in px from the diagram's centre. */
  radius: number;
  /** Tick cross-section (the short dimension), px. */
  tickWidth: number;
  /** Tick length along the radius, px. This is what decides clearance. */
  tickLength: number;
  /** CSS colour — always a `--sc-*` token, never a literal. */
  color: string;
  /**
   * How the caption names this band's records, e.g.
   * `{ one: "connection", many: "connections" }`. §3 puts counts in a caption
   * line, never as labels inside the rings, so this is the only place the
   * band's meaning is written down for a reader.
   */
  noun: { one: string; many: string };
}

/** How many ticks a band actually draws, and what one tick stands for. */
export interface TickBudget {
  /** Number of tick marks to render. */
  ticks: number;
  /** How many records one tick represents. `1` in the ordinary case. */
  recordsPerTick: number;
}

/**
 * Decides the tick budget for a count. One tick per record until
 * `MAX_TICKS_PER_BAND`, then the smallest whole ratio that fits under the cap.
 *
 * The ratio is deliberately whole-numbered rather than fractional: a caption
 * that says "1 tick = 2 connections" is checkable by counting, and a caption
 * that says "1 tick = 1.7 connections" is not.
 */
export function tickBudget(count: number): TickBudget {
  const records = Math.max(0, Math.floor(count));
  if (records === 0) {
    return { ticks: 0, recordsPerTick: 1 };
  }
  const recordsPerTick = Math.max(1, Math.ceil(records / MAX_TICKS_PER_BAND));
  return { ticks: Math.ceil(records / recordsPerTick), recordsPerTick };
}

/**
 * The band's radial footprint — the inner and outer tip of its ticks. §3
 * measures clearance between these, not between radii.
 */
export function bandExtent(band: Pick<RingBandSpec, "radius" | "tickLength">): {
  inner: number;
  outer: number;
} {
  const half = band.tickLength / 2;
  return { inner: band.radius - half, outer: band.radius + half };
}

/**
 * Edge-to-edge gap between each neighbouring pair of bands, in the order given.
 * A negative number means the two bands overlap.
 */
export function bandClearances(bands: readonly Pick<RingBandSpec, "radius" | "tickLength">[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < bands.length; i++) {
    const inner = bands[i - 1];
    const outer = bands[i];
    if (inner === undefined || outer === undefined) continue;
    gaps.push(bandExtent(outer).inner - bandExtent(inner).outer);
  }
  return gaps;
}

/**
 * Where each band starts its tick sequence, in degrees clockwise from twelve
 * o'clock. This is §3's staggering rule, and it is computed rather than tuned.
 *
 * WHY A DERIVED OFFSET AND NOT A CONSTANT
 *
 * Two bands with `m` and `n` ticks place their ticks at `s₁ + j·360/m` and
 * `s₂ + k·360/n`. Subtracting, the possible gaps between a tick of one and a
 * tick of the other are exactly `(s₂ − s₁)` plus any multiple of
 * `360 / lcm(m, n)`. So the bands share an angle precisely when `s₂ − s₁` is a
 * multiple of that value — and the offset that puts their ticks as far apart as
 * the arithmetic allows is exactly half of it.
 *
 * A fixed constant (7°, say) cannot do this: whether 7° happens to be a
 * multiple of `360 / lcm(m, n)` depends on the counts, so for some pairs of
 * real-world counts the bands would align perfectly again — which is the §3 bug
 * ("touching edges on a shared angle draw as one longer tick and make the band
 * undercount") reappearing only for certain users. Deriving the offset from the
 * counts in hand means the guarantee holds for every pair, and
 * `ring-geometry.test.ts` checks all 1600 of them.
 *
 * The first band starts at half its own step so that a one-tick band sits off
 * the vertical axis rather than on it.
 *
 * @param tickCounts Rendered tick counts per band, innermost first — the output
 *   of `tickBudget`, not the raw record counts.
 */
export function ringStartAngles(tickCounts: readonly number[]): number[] {
  const starts: number[] = [];
  let previousStart = 0;
  let previousTicks = 0;

  for (const ticks of tickCounts) {
    if (ticks <= 0) {
      // An empty band draws nothing, so it neither needs a start angle nor gets
      // to push the next band around. Skipping it keeps a user with zero events
      // from changing where their connection ticks sit.
      starts.push(0);
      continue;
    }
    const start =
      previousTicks === 0 ? 180 / ticks : previousStart + guaranteedStaggerDeg(previousTicks, ticks);
    starts.push(start);
    previousStart = start;
    previousTicks = ticks;
  }

  return starts;
}

/** Every tick angle for one band, in degrees clockwise from twelve o'clock. */
export function tickAngles(startAngle: number, ticks: number): number[] {
  if (ticks <= 0) return [];
  const step = 360 / ticks;
  return Array.from({ length: ticks }, (_, i) => startAngle + i * step);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x;
}

function lcm(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return Math.abs(a * b) / gcd(a, b);
}

/**
 * The CSS transform that puts a tick on its ring. Rotate first, then translate
 * along the rotated axis — the tick's own box is centred on the diagram's centre
 * by its margins, so this lands its midpoint exactly `radius` px out and leaves
 * it pointing along the radius.
 */
export function tickTransform(angleDeg: number, radius: number): string {
  return `rotate(${angleDeg.toFixed(2)}deg) translateY(-${radius}px)`;
}

/**
 * The arc an on-ring label needs so it does not clip its own band's ticks —
 * §3's `2·atan(labelWidth/2 / radius)`, in degrees. Unused by any screen today
 * (every caller uses a caption instead, which §3 prefers); see the header.
 */
export function labelGapDegrees(labelWidthPx: number, radius: number): number {
  if (radius <= 0) return 360;
  return (2 * Math.atan(labelWidthPx / 2 / radius) * 180) / Math.PI;
}

/**
 * Every way a set of bands breaks §3, as human-readable sentences. Empty means
 * the layout is legal.
 *
 * Returned rather than thrown: this runs during render on a screen a person is
 * trying to use, and a profile that fails to load because two rings are 7px
 * apart would be a worse outcome than a slightly tight diagram. The test suite
 * is where this is an error — `ring-geometry.test.ts` asserts every layout the
 * app actually ships produces zero violations, so a bad layout fails the build
 * rather than reaching a user in the first place.
 */
export function ringGeometryViolations(bands: readonly RingBandSpec[]): string[] {
  const problems: string[] = [];

  for (let i = 1; i < bands.length; i++) {
    const inner = bands[i - 1];
    const outer = bands[i];
    if (inner === undefined || outer === undefined) continue;
    if (outer.radius <= inner.radius) {
      problems.push(`Band "${outer.key}" must sit outside band "${inner.key}" — pass bands innermost first.`);
    }
  }

  bandClearances(bands).forEach((gap, i) => {
    const inner = bands[i];
    const outer = bands[i + 1];
    if (inner === undefined || outer === undefined) return;
    if (gap < MIN_BAND_CLEARANCE_PX) {
      problems.push(
        `Bands "${inner.key}" and "${outer.key}" are ${gap.toFixed(1)}px apart tick-tip to tick-tip; DESIGN.md §3 requires at least ${MIN_BAND_CLEARANCE_PX}px.`,
      );
    }
  });

  // Two bands sharing a tick angle is the §3 bug, checked on the angles that
  // will actually be rendered rather than by trusting `ringStartAngles` to have
  // been called. A caller that hand-rolls its own start angles is caught here.
  const tickCounts = bands.map((b) => tickBudget(b.count).ticks);
  const starts = ringStartAngles(tickCounts);
  for (let i = 1; i < bands.length; i++) {
    const inner = bands[i - 1];
    const outer = bands[i];
    const innerTicks = tickCounts[i - 1] ?? 0;
    const outerTicks = tickCounts[i] ?? 0;
    if (inner === undefined || outer === undefined) continue;
    if (innerTicks === 0 || outerTicks === 0) continue;
    if (
      sharesAnyAngle(
        tickAngles(starts[i - 1] ?? 0, innerTicks),
        tickAngles(starts[i] ?? 0, outerTicks),
      )
    ) {
      problems.push(
        `Bands "${inner.key}" and "${outer.key}" place ticks on a shared angle; DESIGN.md §3 requires staggered start angles.`,
      );
    }
  }

  return problems;
}

/**
 * Whether two angle sets collide. Compared modulo 360 with a tolerance, because
 * these are floating-point degrees and two ticks a thousandth of a degree apart
 * are the same tick as far as a reader's eye is concerned.
 */
export function sharesAnyAngle(a: readonly number[], b: readonly number[], toleranceDeg = 0.05): boolean {
  return a.some((x) =>
    b.some((y) => {
      const delta = Math.abs(normalizeDeg(x) - normalizeDeg(y));
      return Math.min(delta, 360 - delta) <= toleranceDeg;
    }),
  );
}

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * The caption line §3 mandates: "12 connections · 6 events", stated beneath the
 * diagram and never inside it. Also carries the tick ratio when a band had to
 * compress, so a diagram whose ticks no longer map one-to-one says so in words.
 */
export interface BandCaption {
  key: string;
  color: string;
  tickWidth: number;
  tickLength: number;
  /** e.g. "12 connections", "1 connection", "No connections". */
  text: string;
  /** e.g. "1 tick = 2 connections", or `null` when one tick is one record. */
  ratio: string | null;
}

export function bandCaption(band: RingBandSpec): BandCaption {
  const { recordsPerTick } = tickBudget(band.count);
  const noun = band.count === 1 ? band.noun.one : band.noun.many;
  return {
    key: band.key,
    color: band.color,
    tickWidth: band.tickWidth,
    tickLength: band.tickLength,
    text: band.count === 0 ? `No ${band.noun.many}` : `${band.count} ${noun}`,
    ratio: recordsPerTick > 1 ? `1 tick = ${recordsPerTick} ${band.noun.many}` : null,
  };
}
