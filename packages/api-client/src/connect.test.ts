import { describe, expect, it, vi } from "vitest";

import { ConnectApiError, createQrSession, heartbeatQrSession, redeemQr } from "./connect";

/**
 * These tests run under plain Node (no DOM, no real network — `fetchImpl` is
 * always a stub) and cover the one thing this file is actually responsible
 * for: turning an HTTP response into the right typed value or the right
 * thrown error. They do not re-test the routes themselves (that suite lives
 * server-side) and do not construct real GPS fixes or tokens — just response
 * bodies shaped the way the real routes shape them.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const VALID_HEARTBEAT_REQUEST = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  location: {
    latitude: 40.0,
    longitude: -73.0,
    accuracyM: 10,
    capturedAt: "2026-08-13T18:01:00.000Z",
  },
};

const VALID_REDEEM_REQUEST = {
  token: "a.b",
  scannerLocation: {
    latitude: 40.0001,
    longitude: -73.0001,
    accuracyM: 8,
    capturedAt: "2026-08-13T18:01:00.000Z",
  },
};

describe("createQrSession", () => {
  it("returns the parsed session on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        sessionId: "11111111-1111-4111-8111-111111111111",
        token: "signed-token",
        rotateAfterSeconds: 30,
        expiresAt: "2026-08-13T18:05:00.000Z",
      }),
    );

    const result = await createQrSession({}, { fetchImpl });

    expect(result.token).toBe("signed-token");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/connect/qr/session",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws ConnectApiError with the server's own message on refusal", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(429, { ok: false, message: "You've tried that too many times. Wait a little while and try again." }));

    await expect(createQrSession({}, { fetchImpl })).rejects.toMatchObject({
      name: "ConnectApiError",
      message: "You've tried that too many times. Wait a little while and try again.",
      status: 429,
    });
  });

  it("throws a generic ConnectApiError with status null when the network itself fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network down"));

    const error = await createQrSession({}, { fetchImpl }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConnectApiError);
    expect((error as ConnectApiError).status).toBeNull();
  });

  it("throws rather than returning a value for an unparseable body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(createQrSession({}, { fetchImpl })).rejects.toBeInstanceOf(ConnectApiError);
  });
});

describe("heartbeatQrSession", () => {
  it("parses an active response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { status: "active", token: "t2", rotateAfterSeconds: 30, expiresAt: "2026-08-13T18:05:00.000Z" }),
    );

    const result = await heartbeatQrSession(VALID_HEARTBEAT_REQUEST, { fetchImpl });
    expect(result).toEqual({
      status: "active",
      token: "t2",
      rotateAfterSeconds: 30,
      expiresAt: "2026-08-13T18:05:00.000Z",
    });
  });

  it("parses a consumed response with no token — the presenter's success signal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { status: "consumed" }));

    const result = await heartbeatQrSession(VALID_HEARTBEAT_REQUEST, { fetchImpl });
    expect(result).toEqual({ status: "consumed" });
  });

  it("throws ConnectApiError, not a value, when the session is gone", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { ok: false, message: "We couldn't complete that connection. Ask them to show you a fresh code and try again." }));

    await expect(heartbeatQrSession(VALID_HEARTBEAT_REQUEST, { fetchImpl })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("validates the request shape before ever calling fetch", async () => {
    const fetchImpl = vi.fn();

    await expect(
      heartbeatQrSession({ sessionId: "not-a-uuid", location: VALID_HEARTBEAT_REQUEST.location }, { fetchImpl }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("redeemQr", () => {
  it("returns an ok: true result without throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        connectionId: "11111111-1111-4111-8111-111111111111",
        meetingId: "22222222-2222-4222-8222-222222222222",
      }),
    );

    const result = await redeemQr(VALID_REDEEM_REQUEST, { fetchImpl });
    expect(result.ok).toBe(true);
  });

  it("returns an ok: false result without throwing — a rejection is a normal answer here", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: false, message: "You need to be near each other to connect." }));

    const result = await redeemQr(VALID_REDEEM_REQUEST, { fetchImpl });
    expect(result).toEqual({ ok: false, message: "You need to be near each other to connect." });
  });

  it("still returns ok: false (not a throw) even when the server used a non-2xx status for it", async () => {
    // `qr/redeem` itself only ever returns 200 for a `{ ok: false }` shape,
    // but an *unhandled* error on that route (`connectErrorResponse`, 500)
    // produces the exact same `{ ok: false, message }` shape at a different
    // status — and that shape is a valid `ok: false` redeem response too. The
    // client treats it as the same kind of answer rather than as a special
    // transport failure, so a screen only ever has one thing to check: `.ok`.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { ok: false, message: "We couldn't complete that connection. Ask them to show you a fresh code and try again." }));

    const result = await redeemQr(VALID_REDEEM_REQUEST, { fetchImpl });
    expect(result.ok).toBe(false);
  });

  it("throws ConnectApiError for a body matching neither branch of the union", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { surprise: true }));

    await expect(redeemQr(VALID_REDEEM_REQUEST, { fetchImpl })).rejects.toBeInstanceOf(ConnectApiError);
  });
});
