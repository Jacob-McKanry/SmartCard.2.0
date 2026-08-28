import type { GpsFixInput } from "@smartcard/types";

/**
 * Turns the browser Geolocation API into the exact shape `gpsFixInputSchema`
 * (`packages/types`) expects, and into the fail-closed states CLAUDE.md and
 * §4.3's table require: "GPS unavailable or permission denied -> reject the
 * connection... never fail open."
 *
 * WHY `maximumAge: 0` UNCONDITIONALLY
 * Every caller of `getFreshLocation` — the presenter's first fix, every
 * heartbeat after it, and the scanner's fix at redeem time — needs a fix the
 * device took *now*, not one the browser happens to have cached. §4.3's
 * amendment is explicit that "a stale scanner fix must never substitute for a
 * live one," and the same freshness property is what the presenter's
 * heartbeat depends on (§4.2's amendment: "the nonce only rotates when a
 * fresh location arrives"). One function with one policy means there is no
 * second call site that could quietly accept a cached fix because it seemed
 * harmless in the moment.
 *
 * WHY THIS RETURNS A RESULT OBJECT RATHER THAN THROWING
 * A denied permission or an unavailable fix is an ordinary, expected outcome
 * on this screen — not a bug — and every caller has to render a specific
 * explanation for it (§4.3's fail-closed table: "reject, explain why"). A
 * discriminated result makes that branch impossible to forget; a thrown
 * error is easy to let bubble into a generic catch-all instead.
 */

export type LocationDenialReason =
  | "permission-denied"
  | "position-unavailable"
  | "timeout"
  | "unsupported";

export type FreshLocationResult = { ok: true; fix: GpsFixInput } | { ok: false; reason: LocationDenialReason };

/** The subset of the `Geolocation` API this module uses — narrow, so a fake for tests needs no more. */
export interface GeolocationLike {
  getCurrentPosition(
    success: (position: GeolocationPosition) => void,
    error: (error: GeolocationPositionError) => void,
    options?: PositionOptions,
  ): void;
}

/**
 * Maps the three `GeolocationPositionError` codes the spec defines.
 * `PERMISSION_DENIED = 1`, `POSITION_UNAVAILABLE = 2`, `TIMEOUT = 3` — pulled
 * out as a pure function (rather than inlined in the promise executor below)
 * specifically so it is unit-testable without a real `navigator.geolocation`.
 */
export function mapGeolocationErrorCode(code: number): LocationDenialReason {
  switch (code) {
    case 1:
      return "permission-denied";
    case 3:
      return "timeout";
    case 2:
    default:
      return "position-unavailable";
  }
}

/**
 * User-facing copy for each denial reason.
 *
 * These are NOT drawn from `packages/core/src/connect/user-messages.ts` —
 * that file's messages are answers from the API about a specific connection
 * attempt (§4.2 step 7's rule: describe the caller's own device, never the
 * other party or a threshold). These strings fire before any request is ever
 * sent; there is no server-authored message to reuse, and the same
 * "describe only the caller's own device" rule the API messages follow is
 * still what's being honoured here — every string below is about this
 * device's own permission or signal state, and none of them are.
 */
export function locationDenialMessage(reason: LocationDenialReason): string {
  switch (reason) {
    case "permission-denied":
      // Deliberately more specific than "check your settings", per the
      // 2026-08-28 report: a device's Location Services can be fully on while
      // the BROWSER still remembers a per-site denial for this address —
      // that per-site permission lives separately, in the browser's own
      // site/page settings menu (Safari: the "aA" icon in the address bar;
      // Chrome: the icon left of the address bar), not in the device's
      // system settings. Turning the device toggle on alone does not clear
      // an earlier per-site "don't allow", which is what a real fix report
      // traced back to. The reload instruction stays: a permission fixed
      // mid-session is not always picked up by "Try again" alone.
      return "SmartCard needs your location to confirm you met in person. This looks like a site-specific permission rather than your device's location setting — check this browser's site settings for smartcard.tech (tap the icon next to the address bar) and allow location there, then reload this page.";
    case "position-unavailable":
      return "We couldn't get a GPS fix on this device. Move somewhere with a clearer view of the sky and try again.";
    case "timeout":
      return "Getting your location took too long. Check your connection and try again.";
    case "unsupported":
      return "This browser doesn't support location access, which SmartCard needs to confirm you met in person.";
  }
}

const FRESH_LOCATION_TIMEOUT_MS = 15_000;

/**
 * Requests a fresh, high-accuracy fix. `geolocation` defaults to
 * `navigator.geolocation` but is a parameter so this is callable — and
 * testable — without a real browser.
 */
export function getFreshLocation(
  geolocation: GeolocationLike | undefined = typeof navigator === "undefined" ? undefined : navigator.geolocation,
): Promise<FreshLocationResult> {
  if (!geolocation) {
    return Promise.resolve({ ok: false, reason: "unsupported" });
  }

  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (position) => {
        resolve({
          ok: true,
          fix: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyM: position.coords.accuracy,
            capturedAt: new Date(position.timestamp).toISOString(),
          },
        });
      },
      (error) => {
        resolve({ ok: false, reason: mapGeolocationErrorCode(error.code) });
      },
      { enableHighAccuracy: true, timeout: FRESH_LOCATION_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}
