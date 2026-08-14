/**
 * Maps `getUserMedia` failures to the same kind of fail-closed, explained
 * denial the geolocation module (`geolocation.ts`) uses for GPS — "clear,
 * specific explanation and stop," never a silent blank camera view.
 */

export type CameraDenialReason = "permission-denied" | "not-found" | "unsupported" | "other";

/**
 * `DOMException.name` values `getUserMedia` actually throws, per the
 * MediaDevices spec. Pulled into a pure function so it is testable without a
 * real camera or a real `DOMException`.
 */
export function mapCameraErrorName(name: string): CameraDenialReason {
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "permission-denied";
    case "NotFoundError":
    case "OverconstrainedError":
      return "not-found";
    default:
      return "other";
  }
}

export function cameraDenialMessage(reason: CameraDenialReason): string {
  switch (reason) {
    case "permission-denied":
      return "SmartCard needs your camera to scan a code. Camera access is turned off for this site — turn it on in your browser or device settings, then reload this page.";
    case "not-found":
      return "We couldn't find a camera on this device.";
    case "unsupported":
      return "This browser doesn't support camera access, which SmartCard needs to scan a code.";
    case "other":
      return "We couldn't start the camera. Try again in a moment.";
  }
}
