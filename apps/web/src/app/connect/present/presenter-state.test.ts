import { describe, expect, it } from "vitest";

import { initialPresenterState, presenterReducer, type PresenterState } from "./presenter-state";

describe("presenterReducer", () => {
  it("starts requesting location", () => {
    expect(initialPresenterState).toEqual({ phase: "requesting-location" });
  });

  it("fails closed to location-denied and never proceeds to starting a session from there", () => {
    const state = presenterReducer(initialPresenterState, {
      type: "location-denied",
      reason: "permission-denied",
    });
    expect(state).toEqual({ phase: "location-denied", reason: "permission-denied" });
  });

  it("moves requesting-location -> starting -> active on a successful session create", () => {
    let state = presenterReducer(initialPresenterState, { type: "starting" });
    expect(state.phase).toBe("starting");

    state = presenterReducer(state, {
      type: "session-started",
      sessionId: "s1",
      token: "t1",
      rotateAfterSeconds: 30,
    });
    expect(state).toEqual({ phase: "active", sessionId: "s1", token: "t1", rotateAfterSeconds: 30 });
  });

  it("rotates the token in place on an ordinary heartbeat, keeping the same session id", () => {
    const active: PresenterState = { phase: "active", sessionId: "s1", token: "t1", rotateAfterSeconds: 30 };
    const next = presenterReducer(active, {
      type: "heartbeat-active",
      token: "t2",
      rotateAfterSeconds: 30,
    });
    expect(next).toEqual({ phase: "active", sessionId: "s1", token: "t2", rotateAfterSeconds: 30 });
  });

  it("moves active -> connected when the heartbeat reports the session was scanned", () => {
    const active: PresenterState = { phase: "active", sessionId: "s1", token: "t1", rotateAfterSeconds: 30 };
    expect(presenterReducer(active, { type: "heartbeat-consumed" })).toEqual({ phase: "connected" });
  });

  it("moves active -> ended when the heartbeat reports the session died for any other reason", () => {
    const active: PresenterState = { phase: "active", sessionId: "s1", token: "t1", rotateAfterSeconds: 30 };
    expect(presenterReducer(active, { type: "heartbeat-ended" })).toEqual({ phase: "ended" });
  });

  it("moves to error on a failed call, carrying the message and nothing else", () => {
    const active: PresenterState = { phase: "active", sessionId: "s1", token: "t1", rotateAfterSeconds: 30 };
    expect(presenterReducer(active, { type: "failed", message: "boom" })).toEqual({
      phase: "error",
      message: "boom",
    });
  });

  it("restart always returns to requesting-location, from any phase", () => {
    const phases: PresenterState[] = [
      { phase: "location-denied", reason: "timeout" },
      { phase: "connected" },
      { phase: "ended" },
      { phase: "error", message: "x" },
      { phase: "active", sessionId: "s", token: "t", rotateAfterSeconds: 30 },
    ];
    for (const phase of phases) {
      expect(presenterReducer(phase, { type: "restart" })).toEqual({ phase: "requesting-location" });
    }
  });

  it("ignores a late heartbeat-active response once the state has already moved past active", () => {
    const connected: PresenterState = { phase: "connected" };
    const result = presenterReducer(connected, {
      type: "heartbeat-active",
      token: "late-token",
      rotateAfterSeconds: 30,
    });
    expect(result).toBe(connected);
  });
});
