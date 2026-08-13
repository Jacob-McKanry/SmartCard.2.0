import { describe, expect, it } from "vitest";

import {
  initialScannerState,
  NOT_A_SMARTCARD_CODE_NOTE,
  scannerReducer,
  type ScannerState,
} from "./scanner-state";

describe("scannerReducer", () => {
  it("starts requesting camera access", () => {
    expect(initialScannerState).toEqual({ phase: "requesting-camera" });
  });

  it("fails closed to camera-denied and never proceeds to scanning from there", () => {
    const state = scannerReducer(initialScannerState, { type: "camera-denied", reason: "permission-denied" });
    expect(state).toEqual({ phase: "camera-denied", reason: "permission-denied" });
  });

  it("moves to scanning once the camera is ready", () => {
    expect(scannerReducer(initialScannerState, { type: "camera-ready" })).toEqual({
      phase: "scanning",
      note: null,
    });
  });

  it("treats a non-matching decoded code as a transient note, never a failure", () => {
    const scanning: ScannerState = { phase: "scanning", note: null };
    const next = scannerReducer(scanning, { type: "code-ignored" });
    expect(next).toEqual({ phase: "scanning", note: NOT_A_SMARTCARD_CODE_NOTE });
    // Still "scanning" — the camera loop keeps running.
    expect(next.phase).toBe("scanning");
  });

  it("moves scanning -> verifying on a matching code", () => {
    const scanning: ScannerState = { phase: "scanning", note: null };
    expect(scannerReducer(scanning, { type: "code-detected" })).toEqual({ phase: "verifying" });
  });

  it("fails closed to location-denied from verifying when the fresh fix fails", () => {
    const verifying: ScannerState = { phase: "verifying" };
    expect(scannerReducer(verifying, { type: "location-denied", reason: "position-unavailable" })).toEqual({
      phase: "location-denied",
      reason: "position-unavailable",
    });
  });

  it("moves verifying -> success on an ok: true redeem result", () => {
    const verifying: ScannerState = { phase: "verifying" };
    expect(scannerReducer(verifying, { type: "redeem-success" })).toEqual({ phase: "success" });
  });

  it("moves verifying -> failure carrying the API's own message verbatim", () => {
    const verifying: ScannerState = { phase: "verifying" };
    const message = "You need to be near each other to connect.";
    expect(scannerReducer(verifying, { type: "redeem-failure", message })).toEqual({
      phase: "failure",
      message,
    });
  });

  it("moves verifying -> error on a transport failure", () => {
    const verifying: ScannerState = { phase: "verifying" };
    expect(scannerReducer(verifying, { type: "failed", message: "network down" })).toEqual({
      phase: "error",
      message: "network down",
    });
  });

  it("scan-again always returns to a clean scanning state", () => {
    const terminalStates: ScannerState[] = [
      { phase: "success" },
      { phase: "failure", message: "x" },
      { phase: "error", message: "y" },
      { phase: "location-denied", reason: "timeout" },
    ];
    for (const state of terminalStates) {
      expect(scannerReducer(state, { type: "scan-again" })).toEqual({ phase: "scanning", note: null });
    }
  });

  it("ignores redeem results and location-denied that arrive outside of verifying", () => {
    const scanning: ScannerState = { phase: "scanning", note: null };
    expect(scannerReducer(scanning, { type: "redeem-success" })).toBe(scanning);
    expect(scannerReducer(scanning, { type: "redeem-failure", message: "late" })).toBe(scanning);
    expect(scannerReducer(scanning, { type: "location-denied", reason: "timeout" })).toBe(scanning);
    expect(scannerReducer(scanning, { type: "failed", message: "late" })).toBe(scanning);
  });

  it("ignores a decoded-code-ignored event outside of scanning (e.g. mid-verify)", () => {
    const verifying: ScannerState = { phase: "verifying" };
    expect(scannerReducer(verifying, { type: "code-ignored" })).toBe(verifying);
  });
});
