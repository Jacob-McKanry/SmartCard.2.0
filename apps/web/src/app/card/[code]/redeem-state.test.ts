import { describe, expect, it } from "vitest";

import { initialRedeemState, redeemReducer, type RedeemState } from "./redeem-state";

describe("redeemReducer", () => {
  it("starts verifying — the redeem call fires as soon as the screen mounts", () => {
    expect(initialRedeemState).toEqual({ phase: "verifying" });
  });

  it("moves verifying -> success on an ok: true redeem result, carrying the meeting id", () => {
    // `meetingId` is an internal handle, not something rendered — the flow
    // needs it to attach a location once one arrives (§4.5's 2026-08-28
    // amendment). Asserted here so a future edit cannot quietly drop it and
    // silently disable the location attach with no visible symptom.
    expect(redeemReducer(initialRedeemState, { type: "redeem-success", meetingId: "m-1" })).toEqual({
      phase: "success",
      meetingId: "m-1",
    });
  });

  it("moves verifying -> failure carrying the API's own message verbatim", () => {
    const message = "That card isn't set up yet.";
    expect(redeemReducer(initialRedeemState, { type: "redeem-failure", message })).toEqual({
      phase: "failure",
      message,
    });
  });

  it("moves verifying -> error on a transport failure, distinct from an ordinary rejection", () => {
    const message = "Couldn't reach SmartCard. Check your connection and try again.";
    expect(redeemReducer(initialRedeemState, { type: "failed", message })).toEqual({
      phase: "error",
      message,
    });
  });

  it("ignores a redeem outcome that arrives after the phase already moved on", () => {
    // Defensive only — mirrors scanner-state.ts's guard against a stale async
    // resolution dispatching into a state that has already moved past it.
    const success: RedeemState = { phase: "success", meetingId: "m-1" };
    expect(redeemReducer(success, { type: "redeem-failure", message: "late" })).toBe(success);
  });

  it("retry re-enters verifying from failure", () => {
    const failure: RedeemState = { phase: "failure", message: "That card isn't set up yet." };
    expect(redeemReducer(failure, { type: "retry" })).toEqual({ phase: "verifying" });
  });

  it("retry re-enters verifying from error", () => {
    const error: RedeemState = { phase: "error", message: "Couldn't reach SmartCard." };
    expect(redeemReducer(error, { type: "retry" })).toEqual({ phase: "verifying" });
  });

  it("retry is a no-op while already verifying", () => {
    expect(redeemReducer(initialRedeemState, { type: "retry" })).toBe(initialRedeemState);
  });
});
