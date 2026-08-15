import type { ReactNode } from "react";

import { BlurUpPhoto } from "./blur-up-photo";
import {
  RING_PRESETS,
  bandCaption,
  ringGeometryViolations,
  ringStartAngles,
  tickAngles,
  tickBudget,
  tickTransform,
  type RingBandSpec,
  type RingPresetName,
} from "./ring-geometry";

/**
 * The ring diagram — `docs/design/DESIGN.md` §3's identity motif. Concentric
 * bands of tick marks, no filled rings, one tick per record, with the counts
 * stated in a caption line beneath rather than as labels inside the rings.
 *
 * A server component: it renders from counts the page already fetched and has
 * no interaction, so there is nothing here that needs to reach the browser as
 * JavaScript. The only animated part is the centre medallion's blur-up, which
 * is a CSS keyframe.
 *
 * WHY THE MATHS LIVES NEXT DOOR
 *
 * Everything numeric is in `ring-geometry.ts` and unit-tested there. §3 says of
 * its geometry rules "each was a real bug", and this app's test runner is node
 * with no DOM (see `apps/web/vitest.config.ts`), so the rules are only testable
 * if they are arithmetic rather than JSX. This file is deliberately just the
 * drawing.
 *
 * ACCESSIBILITY (§8)
 *
 * The rings themselves are decoration and are hidden from assistive tech; the
 * caption beneath is the real content and is ordinary text. That satisfies
 * "status colour is never the only signal" without duplicating anything: each
 * caption chip pairs its band's colour with the band's own tick shape *and* the
 * words, so colour is the third signal rather than the only one.
 */

/** Everything a screen needs to state to draw the diagram. */
export interface RingDiagramProps {
  /** Which of §3's sizes to draw at. Decides the box and the band radii. */
  preset: RingPresetName;
  /**
   * One entry per band, innermost first. Shorter than the preset's band list is
   * fine and normal — see the header note on Profile's missing third band.
   */
  bands: readonly RingBandData[];
  /** The medallion in the middle: initials, or a photo that blurs up. */
  centre: ReactNode;
  /**
   * Sentence describing the whole diagram for a screen reader, e.g.
   * "Alex Chen's record: 9 connections, 4 events attended." The caption chips
   * carry the same facts visually.
   */
  summary: string;
  className?: string;
}

/** A band's count and meaning; its radius and tick size come from the preset. */
export interface RingBandData {
  key: string;
  count: number;
  color: string;
  noun: { one: string; many: string };
}

export function RingDiagram({ preset, bands, centre, summary, className }: RingDiagramProps) {
  const shape = RING_PRESETS[preset];

  // Zip the caller's counts onto the preset's radii. A caller that supplies more
  // bands than the preset has radii for gets the extras dropped rather than
  // stacked on top of each other — see the geometry violations logged below.
  const specs: RingBandSpec[] = bands.flatMap((data, index) => {
    const radii = shape.bands[index];
    return radii === undefined ? [] : [{ ...data, ...radii }];
  });

  const violations = ringGeometryViolations(specs);
  if (violations.length > 0) {
    // Logged, not thrown: a slightly tight diagram is a far better outcome for
    // the person looking at the screen than a profile that fails to render.
    // `ring-geometry.test.ts` is where this is fatal — it asserts every layout
    // the app ships produces no violations, so this line firing in production
    // means a layout reached us that the test suite has never seen.
    console.error("[ring-diagram] geometry violates DESIGN.md §3", { preset, violations });
  }

  const tickCounts = specs.map((spec) => tickBudget(spec.count).ticks);
  const starts = ringStartAngles(tickCounts);
  const captions = specs.map(bandCaption);

  return (
    <div className={className}>
      <div
        className="relative mx-auto"
        style={{ width: shape.box, height: shape.box, maxWidth: "100%" }}
        role="img"
        aria-label={summary}
      >
        {specs.map((spec, bandIndex) => (
          <div key={spec.key} aria-hidden>
            {/*
             * The guide circle. A hairline, never a filled ring (§3) — it exists
             * so a band with few records still reads as a band rather than as
             * scattered marks, and so an empty band is visibly an empty band
             * rather than a missing one.
             */}
            <span
              className="absolute top-1/2 left-1/2 rounded-full border"
              style={{
                width: spec.radius * 2,
                height: spec.radius * 2,
                margin: `${-spec.radius}px`,
                borderColor: guideColorFor(spec.color),
              }}
            />
            {tickAngles(starts[bandIndex] ?? 0, tickCounts[bandIndex] ?? 0).map((angle, i) => (
              <span
                key={i}
                className="absolute top-1/2 left-1/2"
                style={{
                  width: spec.tickWidth,
                  height: spec.tickLength,
                  margin: `${-spec.tickLength / 2}px ${-spec.tickWidth / 2}px`,
                  borderRadius: Math.max(1, spec.tickWidth / 2),
                  background: spec.color,
                  transform: tickTransform(angle, spec.radius),
                }}
              />
            ))}
          </div>
        ))}

        {centre}
      </div>

      {/*
       * §3: "Counts are stated in a caption line beneath the diagram, never as
       * labels inside the rings." Each chip shows the band's own tick shape at
       * its own colour, so the mapping from chip to band needs no legend.
       */}
      <ul className="mt-1 flex flex-wrap justify-center gap-1.5">
        {captions.map((caption) => (
          <li
            key={caption.key}
            className="flex items-center gap-[7px] rounded-full border px-2.5 py-[5px] text-[11px] leading-[15px] font-medium"
            style={{
              color: "var(--sc-text-muted)",
              background: "rgba(255,255,255,.7)",
              borderColor: "rgba(13,18,32,.07)",
            }}
          >
            <span
              aria-hidden
              className="shrink-0"
              style={{
                width: caption.tickWidth,
                height: caption.tickLength,
                borderRadius: Math.max(1, caption.tickWidth / 2),
                background: caption.color,
              }}
            />
            {caption.text}
            {caption.ratio ? (
              <span className="font-mono text-[10px]" style={{ color: "var(--sc-text-subtle)" }}>
                {caption.ratio}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The guide circle for a band, at the same hue as its ticks but far weaker.
 *
 * Hardcoded per token rather than computed with `color-mix`, because these are
 * the exact three values the prototype renders and the point of this port is
 * that the shipped screen and the design artifact agree pixel for pixel. An
 * unrecognised colour falls back to the neutral hairline rather than to nothing,
 * so a future band still gets a guide.
 */
function guideColorFor(tickColor: string): string {
  switch (tickColor) {
    case "var(--sc-accent)":
      return "rgba(11,96,255,.2)";
    case "var(--sc-text)":
      return "rgba(13,18,32,.12)";
    case "var(--sc-ink-deep)":
      return "rgba(10,63,176,.18)";
    default:
      return "rgba(13,18,32,.12)";
  }
}

/**
 * The medallion at the centre of a ring diagram: a photo if there is one, the
 * person's initials if there isn't.
 *
 * "No photo" is not a degraded state and gets no placeholder treatment — most
 * pilot accounts will not have uploaded one, and §5's placeholder rule is about
 * missing *imagery in a layout that needs it*, not about a person who chose not
 * to add a picture of themselves.
 */
export function RingCentre({
  photoUrl,
  initials,
  size = 96,
  fontSize = 26,
}: {
  photoUrl: string | null;
  initials: string;
  size?: number;
  fontSize?: number;
}) {
  return (
    <div
      className="absolute top-1/2 left-1/2 flex items-center justify-center overflow-hidden rounded-full border font-semibold"
      style={{
        width: size,
        height: size,
        margin: `${-size / 2}px`,
        fontSize,
        lineHeight: 1,
        background: "linear-gradient(140deg, rgba(11,96,255,.2), rgba(124,58,237,.16))",
        borderColor: "rgba(255,255,255,.92)",
        color: "var(--sc-text)",
        // The medallion itself fades in rather than popping. A photo layered on
        // top gets its own load-driven blur-up.
        animation: "sc-blurup 1s var(--sc-ease-glide) both",
      }}
    >
      {/*
       * Initials sit underneath rather than instead-of, so they are what shows
       * while a signed URL is still in flight and what remains if it expires or
       * 404s. `BlurUpPhoto` removes itself on error, uncovering them.
       */}
      <span aria-hidden>{initials}</span>
      {photoUrl === null ? null : (
        <BlurUpPhoto src={photoUrl} alt="" className="absolute inset-0 size-full object-cover" />
      )}
    </div>
  );
}

