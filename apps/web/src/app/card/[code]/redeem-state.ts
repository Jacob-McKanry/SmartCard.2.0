/**
 * The card-tap redeem screen's state machine — DOM-free and unit-tested on
 * its own, the same split `scanner-state.ts` and `presenter-state.ts` use.
 *
 * WHY THIS IS SIMPLER THAN THE SCAN FLOW'S MACHINE
 * There is no camera permission, no decode loop, and no GPS gate here — §4.5
 * step 2 says physical range through NFC read distance already IS the
 * proximity proof, so nothing on this screen waits on a location fix the way
 * `scanner-state.ts`'s `verifying` phase does. The only asynchronous thing
 * this screen ever does is call `redeemNfc({ code })` once, immediately, on
 * mount — "auto-trigger the redeem call on page load" is the whole point of
 * a tap being near-zero-friction (see the task brief this page was built
 * from). That collapses the machine to four states: verifying, success,
 * failure (an ordinary `{ ok: false, message }` answer), and error (a
 * transport failure — no response to read a message from at all).
 *
 * WHY A "retry" ACTION EXISTS EVEN THOUGH A TAP HAS NO "SCAN AGAIN" BUTTON
 * Unlike the camera scanner, this screen has no live sensor loop to fall back
 * into — the code came from the URL, not from a frame just decoded. But a
 * `failure` or `error` outcome (a dropped connection, a slow backend) is
 * still worth letting the visitor retry without reloading the whole page and
 * re-running the server-side auth check. `retry` re-enters `verifying`,
 * which the flow component treats identically to the initial mount: it fires
 * `redeemNfc` again with the same code.
 */

export type RedeemState =
  | { phase: "verifying" }
  | { phase: "success" }
  | { phase: "failure"; message: string }
  | { phase: "error"; message: string };

export type RedeemAction =
  | { type: "redeem-success" }
  | { type: "redeem-failure"; message: string }
  | { type: "failed"; message: string }
  | { type: "retry" };

export const initialRedeemState: RedeemState = { phase: "verifying" };

export function redeemReducer(state: RedeemState, action: RedeemAction): RedeemState {
  switch (action.type) {
    case "redeem-success":
      if (state.phase !== "verifying") return state;
      return { phase: "success" };

    case "redeem-failure":
      if (state.phase !== "verifying") return state;
      return { phase: "failure", message: action.message };

    case "failed":
      if (state.phase !== "verifying") return state;
      return { phase: "error", message: action.message };

    case "retry":
      if (state.phase === "verifying") return state;
      return { phase: "verifying" };
  }
}
