"use client";

import { useSyncExternalStore } from "react";

/**
 * The mono date line above the greeting on Home.
 *
 * WHY THIS IS A CLIENT COMPONENT AND RENDERS NOTHING ON THE SERVER
 *
 * Every other date in this app is formatted server-side with the locale pinned
 * to `en-US` (see `feed/lib/format.ts` for the reasoning), which is right for a
 * *timestamp on a record*: the meeting happened at one instant, and everyone
 * should read the same instant. "Today's date", though, is a statement about
 * the reader, not about a record. Rendering it on the server means rendering
 * the server's date — UTC in production — so anyone in the Americas would be
 * told it is tomorrow for the last several hours of their evening.
 *
 * WHY `useSyncExternalStore` AND NOT AN EFFECT
 *
 * This is precisely the case that API exists for: a value the server cannot
 * know and the client can. Its third argument is the server snapshot (`null`,
 * so the markup React sends and the markup it hydrates against agree exactly),
 * and its second is the client snapshot, which React swaps in after hydration
 * without a mismatch warning and without the cascading re-render an
 * effect-plus-setState would cause. The subscribe function is a no-op because
 * the value never changes while the page is open — a date line that ticked over
 * at midnight would be a nice touch and is not worth a timer.
 *
 * The slot keeps its height whether or not the value has arrived, so the
 * greeting beneath it never jumps. It is decorative meta at 12px in
 * `--sc-text-subtle`, which §8 permits for decoration only — nothing on the
 * screen depends on it, which is exactly why it is allowed to arrive late.
 */
export function LocalDateLine({ className }: { className?: string }) {
  const today = useSyncExternalStore(subscribeToNothing, readLocalDate, readNoDate);

  return (
    <div
      className={className}
      style={{
        fontFamily: "var(--font-geist-mono)",
        fontWeight: 500,
        fontSize: 12,
        lineHeight: "16px",
        letterSpacing: ".04em",
        color: "var(--sc-text-subtle)",
        minHeight: 16,
      }}
    >
      {today}
    </div>
  );
}

function subscribeToNothing(): () => void {
  return () => {};
}

/**
 * Cached, because React calls `getSnapshot` on every render and compares the
 * result with `Object.is` — returning a freshly built string each time would
 * look like a store that never settles and loop forever.
 */
let cachedLabel: string | null = null;

function readLocalDate(): string {
  cachedLabel ??= new Date()
    .toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })
    .toUpperCase();
  return cachedLabel;
}

function readNoDate(): string | null {
  return null;
}
