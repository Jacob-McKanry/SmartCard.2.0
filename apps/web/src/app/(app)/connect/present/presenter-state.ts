import type { LocationDenialReason } from "../lib/geolocation";

/**
 * The presenter screen's state machine, factored out of the component that
 * drives it (`presenter-flow.tsx`) specifically so it is unit-testable
 * without a DOM — this file imports nothing from React and touches no
 * browser API.
 *
 * THE SHAPE OF THE MACHINE, AND WHY
 *
 *   requesting-location -> location-denied            (fail closed, §4.3's table)
 *   requesting-location -> starting -> active          (session created, QR live)
 *   active -> active                                   (ordinary heartbeat rotation)
 *   active -> connected                                (heartbeat reports status: "consumed")
 *   active -> ended                                     (heartbeat reports status: "ended")
 *   active -> error                                     (heartbeat/session call failed)
 *   any -> requesting-location                          ("show a new code" / retry)
 *
 * `connected` is the whole of the success state the task asks for: "a simple,
 * minimal confirmation... do not build a connection-detail view." There is
 * deliberately no data on that variant beyond the fact of it — no
 * connectionId, no counterpart identity — because the heartbeat response this
 * reads from carries none either (see the `status` field's doc comment in
 * `packages/types`), and there would be nothing to render even if the
 * reducer kept more state than this.
 */

export type PresenterState =
  | { phase: "requesting-location" }
  | { phase: "location-denied"; reason: LocationDenialReason }
  | { phase: "starting" }
  | {
      phase: "active";
      sessionId: string;
      token: string;
      rotateAfterSeconds: number;
    }
  | { phase: "connected" }
  | { phase: "ended" }
  | { phase: "error"; message: string };

export type PresenterAction =
  | { type: "location-denied"; reason: LocationDenialReason }
  | { type: "starting" }
  | { type: "session-started"; sessionId: string; token: string; rotateAfterSeconds: number }
  | { type: "heartbeat-active"; token: string; rotateAfterSeconds: number }
  | { type: "heartbeat-consumed" }
  | { type: "heartbeat-ended" }
  | { type: "failed"; message: string }
  | { type: "restart" };

export const initialPresenterState: PresenterState = { phase: "requesting-location" };

export function presenterReducer(state: PresenterState, action: PresenterAction): PresenterState {
  switch (action.type) {
    case "location-denied":
      return { phase: "location-denied", reason: action.reason };

    case "starting":
      return { phase: "starting" };

    case "session-started":
      return {
        phase: "active",
        sessionId: action.sessionId,
        token: action.token,
        rotateAfterSeconds: action.rotateAfterSeconds,
      };

    case "heartbeat-active":
      // Only meaningful while already active. A heartbeat response can
      // resolve after the state has already moved on (the loop stopped, but
      // one in-flight request was still pending) — ignoring it here, rather
      // than reviving `active` state from `connected`/`ended`/`error`, is
      // what keeps a late response from undoing a screen the user already
      // saw resolve.
      if (state.phase !== "active") return state;
      return {
        phase: "active",
        sessionId: state.sessionId,
        token: action.token,
        rotateAfterSeconds: action.rotateAfterSeconds,
      };

    case "heartbeat-consumed":
      return { phase: "connected" };

    case "heartbeat-ended":
      return { phase: "ended" };

    case "failed":
      return { phase: "error", message: action.message };

    case "restart":
      return { phase: "requesting-location" };
  }
}
