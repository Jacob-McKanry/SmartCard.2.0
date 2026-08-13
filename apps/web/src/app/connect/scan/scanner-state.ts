import type { CameraDenialReason } from "../lib/camera";
import type { LocationDenialReason } from "../lib/geolocation";

/**
 * The scanner screen's state machine — the camera-flow counterpart to
 * `present/presenter-state.ts`, factored out the same way and for the same
 * reason (unit-testable with no DOM, no camera, no GPS).
 *
 * THE SHAPE OF THE MACHINE
 *
 *   requesting-camera -> camera-denied           (fail closed)
 *   requesting-camera -> scanning
 *   scanning -> scanning (note set)              (decoded something that isn't a SmartCard code —
 *                                                  task requirement: NOT treated as a failure)
 *   scanning -> verifying                        (decoded a matching connect URL)
 *   verifying -> location-denied                 (fresh fix failed — fail closed, never redeem
 *                                                  without one)
 *   verifying -> success                         (redeemQr returned ok: true)
 *   verifying -> failure                         (redeemQr returned ok: false — message is the
 *                                                  API's own `userFacingMessage()` text, verbatim)
 *   verifying -> error                           (network/transport failure — see api-client)
 *   success | failure | error | location-denied -> scanning   ("scan again")
 *
 * `failure.message` and `error.message` are stored as opaque strings on
 * purpose — this reducer does not know or care whether a string came from
 * `userFacingMessage()` or from `ConnectApiError`; that discipline belongs to
 * whoever dispatches the action (`scanner-flow.tsx`), which is the one place
 * that talks to the API and therefore the one place that can get it wrong.
 */

export type ScannerState =
  | { phase: "requesting-camera" }
  | { phase: "camera-denied"; reason: CameraDenialReason }
  | { phase: "scanning"; note: string | null }
  | { phase: "verifying" }
  | { phase: "location-denied"; reason: LocationDenialReason }
  | { phase: "success" }
  | { phase: "failure"; message: string }
  | { phase: "error"; message: string };

export type ScannerAction =
  | { type: "camera-denied"; reason: CameraDenialReason }
  | { type: "camera-ready" }
  | { type: "code-ignored" }
  | { type: "code-detected" }
  | { type: "location-denied"; reason: LocationDenialReason }
  | { type: "redeem-success" }
  | { type: "redeem-failure"; message: string }
  | { type: "failed"; message: string }
  | { type: "scan-again" };

export const initialScannerState: ScannerState = { phase: "requesting-camera" };

/** Shown briefly on the scanning screen when a decoded code doesn't match our URL shape. */
export const NOT_A_SMARTCARD_CODE_NOTE = "That doesn't look like a SmartCard code. Keep scanning.";

export function scannerReducer(state: ScannerState, action: ScannerAction): ScannerState {
  switch (action.type) {
    case "camera-denied":
      return { phase: "camera-denied", reason: action.reason };

    case "camera-ready":
      return { phase: "scanning", note: null };

    case "code-ignored":
      // Explicitly NOT a failure state (task requirement) — stays on
      // "scanning" with a transient note, so the camera loop never pauses
      // for something that was never a connect attempt in the first place.
      if (state.phase !== "scanning") return state;
      return { phase: "scanning", note: NOT_A_SMARTCARD_CODE_NOTE };

    case "code-detected":
      return { phase: "verifying" };

    case "location-denied":
      if (state.phase !== "verifying") return state;
      return { phase: "location-denied", reason: action.reason };

    case "redeem-success":
      if (state.phase !== "verifying") return state;
      return { phase: "success" };

    case "redeem-failure":
      if (state.phase !== "verifying") return state;
      return { phase: "failure", message: action.message };

    case "failed":
      if (state.phase !== "verifying") return state;
      return { phase: "error", message: action.message };

    case "scan-again":
      return { phase: "scanning", note: null };
  }
}
