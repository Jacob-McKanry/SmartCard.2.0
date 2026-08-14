/**
 * Best-effort Screen Wake Lock while the presenter's QR code is on screen.
 *
 * WHY THIS EXISTS
 * The task requirement is "best-effort screen-wake-lock while displaying,
 * degrading gracefully where unsupported" — nothing about the connect flow's
 * security model depends on it. If the screen dims or locks mid-presentation
 * that is a UX papercut (the presenter has to wake their phone again), not a
 * security gap: the heartbeat loop and the QR's rotation are driven entirely
 * by `presenter-flow.tsx`'s timers, not by whether the screen happens to be
 * lit, so a lock that never acquires (or one the OS silently drops) changes
 * nothing about how the flow behaves.
 *
 * WHY THE REQUEST/RELEASE FUNCTIONS ARE PLAIN, TYPED WRAPPERS
 * `WakeLockSentinel`/`navigator.wakeLock` are absent from this repo's pinned
 * `lib.dom.d.ts` the same way `BarcodeDetector` is (see
 * `scan/barcode-detector.d.ts`'s header for how that was confirmed) — Safari
 * shipped it after this TypeScript version's DOM types were authored. Narrow
 * ambient types here, scoped to exactly what this module uses, are the same
 * choice made there and for the same reason: real types at the one call site
 * that needs them, rather than `any`.
 *
 * NEVER THROWS. Every function below resolves — a missing API, a request
 * that rejects (backgrounded tab, non-secure context, battery saver on some
 * platforms), and a release call all collapse to "no lock held", which is
 * exactly the degrade-gracefully behaviour the task asks for.
 */

export interface WakeLockSentinelLike {
  release(): Promise<void>;
}

export interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

/** Reads `navigator.wakeLock` without assuming it exists. Null when the browser has no such API. */
export function getWakeLock(
  nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
): WakeLockLike | null {
  const candidate = (nav as unknown as { wakeLock?: WakeLockLike } | undefined)?.wakeLock;
  return candidate ?? null;
}

/** Requests a screen wake lock. Resolves `null` on any failure or when unsupported — never throws. */
export async function requestWakeLock(
  wakeLock: WakeLockLike | null,
): Promise<WakeLockSentinelLike | null> {
  if (wakeLock === null) {
    return null;
  }
  try {
    return await wakeLock.request("screen");
  } catch {
    return null;
  }
}

/** Releases a held lock, swallowing any error — the caller is tearing down regardless of the outcome. */
export async function releaseWakeLock(sentinel: WakeLockSentinelLike | null): Promise<void> {
  if (sentinel === null) {
    return;
  }
  try {
    await sentinel.release();
  } catch {
    // Nothing to recover: the caller no longer wants the lock either way.
  }
}
