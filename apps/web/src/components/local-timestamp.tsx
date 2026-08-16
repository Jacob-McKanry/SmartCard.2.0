"use client";

import { useId } from "react";

/**
 * ONE MEETING TIME, RENDERED ON THE READER'S OWN CLOCK.
 *
 * WHAT WENT WRONG WITHOUT THIS
 *
 * Every screen that showed a meeting time called
 * `new Date(occurredAt).toLocaleString("en-US", { dateStyle, timeStyle })`
 * inside a Server Component. `toLocaleString` with no `timeZone` uses the
 * *runtime's* zone, and the runtime here is a Vercel serverless function,
 * which runs in UTC. So a connection made at 10:00 PM US Central was shown
 * back to the person who made it as "4:00 AM" — the correct instant, printed
 * on the wrong clock, on the one screen whose entire job is to be a truthful
 * record of a real-world event. Six call sites had it independently
 * (connections list, meeting record, Home, Activity, Feed, the event host
 * queue) because each screen wrote its own two-line helper.
 *
 * WHY THE FIX CANNOT JUST BE `timeZone: "..."`
 *
 * Pinning a zone server-side picks one city for everybody. The zone that is
 * correct here is a property of the *reader*, and the server genuinely does
 * not know it: unlike locale, a time zone is not in any request header, and
 * this app sets no cookie for it. Only the browser knows.
 *
 * HOW THIS RENDERS THE READER'S ZONE WITHOUT A FLASH OF THE WRONG TIME
 *
 * The pattern is the one Next.js documents for exactly this case — see
 * `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-
 * hydration.md`, "Dates and formatting". A Client Component renders the
 * `<time>` element, and an inline `<script>` immediately after it rewrites
 * `textContent` using the browser's own zone. The browser runs that script
 * *while parsing the HTML*, before the first paint, so the wrong time is
 * never on screen — unlike a `useEffect`, which runs after paint and would
 * show 4:00 AM and then blink to 10:00 PM.
 *
 * On a client-side navigation (`<Link>`), no HTML is parsed and the script
 * never runs; there the component simply formats in the browser during its
 * own render, which is already the reader's zone. `suppressHydrationWarning`
 * covers the one instant where the two disagree: React compares its output
 * against a DOM the script has already corrected, and this tells it the DOM
 * wins. See that guide's "Understanding suppressHydrationWarning".
 *
 * WHY THE SERVER-RENDERED FALLBACK SAYS "UTC" OUT LOUD
 *
 * Something has to be in the HTML before the script runs, and for a reader
 * with JavaScript disabled that something is final. An unlabelled server-zone
 * time is precisely the bug this file exists to fix, so the fallback prints
 * UTC *and says so*. That is the same rule `events/lib/format.ts` already
 * applies when an event has no stored zone: `docs/design/DESIGN.md` §7 — a
 * screen may not imply something it cannot back, and "10:00 PM" with no
 * qualifier is a claim about the reader's clock. The script replaces the whole
 * string, suffix included, so nobody with JavaScript on ever sees it.
 *
 * WHY LOCALE STAYS PINNED TO en-US
 *
 * Only the *zone* was wrong. `connections/lib/format.ts` pinned `en-US`
 * deliberately, so the app words dates one way everywhere rather than
 * following the reader's locale; that decision is unchanged and is applied on
 * both the server and the client paths here, which is also what keeps the
 * before-and-after strings the same shape.
 *
 * THE CONTENT SECURITY POLICY AND THIS INLINE SCRIPT
 *
 * This emits an inline script. The app DOES ship a CSP (`next.config.ts`), and
 * it currently carries `script-src 'unsafe-inline'` — which is the only reason
 * this script runs at all. (An earlier version of this comment said "the app
 * has no CSP today"; that was already stale and was corrected in the 2026-08
 * security audit.) The two files depend on each other and neither knew it: this
 * script needs `'unsafe-inline'`, and that directive is the CSP's one real
 * weakness. Whoever removes `'unsafe-inline'` — the right long-term move, via a
 * per-request nonce in `middleware.ts` — MUST give this `<script>` that nonce in
 * the same change, or it silently stops running and every reader with JS on is
 * left looking at the labelled-UTC fallback.
 */

export type TimestampFormat = "datetime" | "time";

/**
 * The two shapes a timestamp is shown in across the app. Named rather than
 * passed per call site so a meeting's time reads identically on the record,
 * the list, the feed and the log — the codebase's existing convention of one
 * wording per fact, applied to formatting.
 *
 *  - `datetime` — "Aug 14, 2026, 10:00 PM". Every record and log context.
 *  - `time` — "10:00 PM". The Connect payoff only, where the meeting is
 *    seconds old and the date would be noise.
 */
const FORMATS = {
  datetime: { dateStyle: "medium", timeStyle: "short" },
  time: { hour: "numeric", minute: "2-digit" },
} as const satisfies Record<TimestampFormat, Intl.DateTimeFormatOptions>;

/**
 * Formats an instant in an explicitly named zone.
 *
 * Exported because it is the only part of this module a plain Node test can
 * pin down completely: given an ISO string and a zone, there is exactly one
 * right answer, and `local-timestamp.test.tsx` asserts it for a non-UTC zone
 * so the original bug cannot come back unnoticed.
 */
export function formatTimestampIn(
  iso: string,
  timeZone: string,
  format: TimestampFormat = "datetime",
): string {
  return new Date(iso).toLocaleString("en-US", { ...FORMATS[format], timeZone });
}

/** The labelled server-side fallback described in the header. */
export function utcFallbackLabel(iso: string, format: TimestampFormat = "datetime"): string {
  return `${formatTimestampIn(iso, "UTC", format)} UTC`;
}

/**
 * The inline script that corrects one `<time>` element to the browser's zone.
 *
 * Deliberately has no `timeZone` in its options — that omission *is* the fix,
 * because in a browser the default is the reader's own zone. Exported so a
 * test can execute it against a fake DOM under a non-UTC `TZ` and prove it,
 * rather than only asserting on the string.
 *
 * Values are injected as JSON with `<` escaped, so neither the element id nor
 * the timestamp can close the script tag early. Both are in practice a
 * React-generated id and a database `timestamptz`, but a string interpolated
 * into a `<script>` gets escaped on principle, not on the strength of where it
 * came from today.
 */
export function localTimestampScript(id: string, iso: string, format: TimestampFormat): string {
  return (
    `{var n=document.getElementById(${inlineJson(id)});` +
    `if(n)n.textContent=new Date(${inlineJson(iso)})` +
    `.toLocaleString("en-US",${inlineJson(FORMATS[format])})}`
  );
}

function inlineJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/**
 * `<script>` that runs on a hard navigation and is inert on a soft one.
 *
 * Two things this shape buys, both from the Next.js guide: the `text/plain`
 * type on the client keeps React from warning about a rendered `<script>` and
 * stops it re-running work the component already did in the browser, and
 * `suppressHydrationWarning` absorbs the resulting type mismatch.
 */
function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * A meeting/connection/RSVP timestamp, on the reader's clock.
 *
 * Renders a `<time datetime="...">` so the machine-readable instant is in the
 * markup regardless of what the text says — a screen reader or a crawler gets
 * the unambiguous ISO value even in the fallback state.
 */
export function LocalTimestamp({
  iso,
  format = "datetime",
  className,
  style,
}: {
  iso: string;
  format?: TimestampFormat;
  className?: string;
  style?: React.CSSProperties;
}) {
  const id = useId();

  return (
    <>
      <time
        id={id}
        dateTime={iso}
        className={className}
        style={style}
        suppressHydrationWarning
      >
        {typeof window === "undefined"
          ? utcFallbackLabel(iso, format)
          : new Date(iso).toLocaleString("en-US", FORMATS[format])}
      </time>
      <InlineScript html={localTimestampScript(id, iso, format)} />
    </>
  );
}
