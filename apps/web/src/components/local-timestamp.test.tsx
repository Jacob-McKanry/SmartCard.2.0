import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  LocalTimestamp,
  formatTimestampIn,
  localTimestampScript,
  utcFallbackLabel,
} from "./local-timestamp";

/**
 * THE REGRESSION THIS FILE EXISTS FOR.
 *
 * A connection made at around 10 PM US Central was shown back to the person
 * who made it as "around 4 AM". Nothing was wrong with the stored instant —
 * `meetings.occurred_at` is a `timestamptz` and it was right. What was wrong
 * was that six screens formatted it with `toLocaleString("en-US", …)` and no
 * `timeZone`, inside Server Components. On Vercel that is a UTC Lambda, so
 * every meeting time in the app was printed on the server's clock.
 *
 * The shape of the bug is what makes it easy to reintroduce and easy to miss:
 * it is invisible on a developer's machine (whose zone matches the browser's)
 * and it never throws. So these tests assert the *values*, in a non-UTC zone,
 * rather than that something rendered.
 *
 * The zone below is US Central, which is where the report came from, and the
 * instant is chosen so the two answers fall on different calendar days —
 * exactly the "it says the wrong day AND the wrong time" symptom.
 */

const OCCURRED_AT = "2026-08-15T04:00:00Z";
const VIEWER_ZONE = "America/Chicago";
const VIEWER_SEES = "Aug 14, 2026, 11:00 PM";
const SERVER_SAW = "Aug 15, 2026, 4:00 AM";

describe("formatTimestampIn", () => {
  it("renders a meeting time on the viewer's clock, not the server's", () => {
    expect(formatTimestampIn(OCCURRED_AT, VIEWER_ZONE)).toBe(VIEWER_SEES);
  });

  it("still knows the UTC reading — the instant was never the problem", () => {
    expect(formatTimestampIn(OCCURRED_AT, "UTC")).toBe(SERVER_SAW);
  });

  it("formats the Connect payoff's time-only variant in the viewer's zone too", () => {
    expect(formatTimestampIn(OCCURRED_AT, VIEWER_ZONE, "time")).toBe("11:00 PM");
    expect(formatTimestampIn(OCCURRED_AT, "Asia/Tokyo", "time")).toBe("1:00 PM");
  });
});

describe("the server-rendered fallback", () => {
  /**
   * If the inline script never runs (JavaScript off, or a future CSP without a
   * nonce), whatever the server put in the HTML is final. It must not be a
   * bare, unlabelled server-zone time — that is the original bug wearing a
   * different hat. `docs/design/DESIGN.md` §7.
   */
  it("says UTC out loud rather than passing the server's clock off as local", () => {
    expect(utcFallbackLabel(OCCURRED_AT)).toBe(`${SERVER_SAW} UTC`);
  });

  it("is what the component renders on the server", () => {
    const html = renderToStaticMarkup(<LocalTimestamp iso={OCCURRED_AT} />);
    expect(html).toContain(`${SERVER_SAW} UTC`);
    // The machine-readable instant is in the markup either way, so a screen
    // reader or a crawler is never left with only the fallback's wording.
    // Matched case-insensitively because React serialises the attribute as
    // `dateTime`, which HTML parses the same as `datetime`.
    expect(html.toLowerCase()).toContain(`datetime="${OCCURRED_AT.toLowerCase()}"`);
  });
});

describe("the inline correction script", () => {
  /**
   * The whole fix rests on this script omitting `timeZone`, because in a
   * browser the default is the reader's own zone. An "improvement" that adds
   * one back — even a correct-looking one — reinstates the bug for everybody
   * outside that zone, so it is asserted directly.
   */
  it("passes no timeZone, which is what makes it the viewer's zone", () => {
    const script = localTimestampScript("x", OCCURRED_AT, "datetime");
    expect(script).not.toContain("timeZone");
    expect(script).toContain('"dateStyle":"medium"');
  });

  it("escapes its injected values so a timestamp cannot close the script tag", () => {
    expect(localTimestampScript("</script><b>", OCCURRED_AT, "time")).not.toContain("</script>");
  });
});

/**
 * The end-to-end proof: render the component the way a Server Component does,
 * then actually execute the script it emitted, in a process whose zone is US
 * Central, against a stand-in for the DOM node. What lands in `textContent` is
 * what the person who filed the bug would have seen.
 */
describe("a viewer in US Central, end to end", () => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = VIEWER_ZONE;
  });

  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it("reads 11:00 PM on the 14th, where the server rendered 4:00 AM on the 15th", () => {
    // Guard rather than assume: if a future Node stopped honouring a runtime
    // TZ change, this test would silently pass by comparing UTC with UTC.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(VIEWER_ZONE);

    const html = renderToStaticMarkup(<LocalTimestamp iso={OCCURRED_AT} />);
    expect(html).toContain(`${SERVER_SAW} UTC`);

    const id = /<time id="([^"]+)"/.exec(html)?.[1];
    const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(script).toBeTruthy();

    const node = { textContent: `${SERVER_SAW} UTC` };
    const fakeDocument = {
      getElementById: (wanted: string) => (wanted === id ? node : null),
    };
    new Function("document", script as string)(fakeDocument);

    expect(node.textContent).toBe(VIEWER_SEES);
  });
});
