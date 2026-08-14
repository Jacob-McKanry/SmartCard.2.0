import { describe, expect, it } from "vitest";

import {
  getFreshLocation,
  locationDenialMessage,
  mapGeolocationErrorCode,
  type GeolocationLike,
} from "./geolocation";

describe("mapGeolocationErrorCode", () => {
  it("maps the three GeolocationPositionError codes the spec defines", () => {
    expect(mapGeolocationErrorCode(1)).toBe("permission-denied");
    expect(mapGeolocationErrorCode(2)).toBe("position-unavailable");
    expect(mapGeolocationErrorCode(3)).toBe("timeout");
  });

  it("fails closed to position-unavailable for anything unrecognised", () => {
    expect(mapGeolocationErrorCode(99)).toBe("position-unavailable");
  });
});

describe("locationDenialMessage", () => {
  it("gives every reason its own non-empty explanation", () => {
    for (const reason of ["permission-denied", "position-unavailable", "timeout", "unsupported"] as const) {
      expect(locationDenialMessage(reason).length).toBeGreaterThan(0);
    }
  });

  it("never contains a number — no threshold or distance is described here", () => {
    for (const reason of ["permission-denied", "position-unavailable", "timeout", "unsupported"] as const) {
      expect(locationDenialMessage(reason)).not.toMatch(/\d/);
    }
  });
});

describe("getFreshLocation", () => {
  it("resolves ok: false, reason: unsupported when there is no geolocation API at all", async () => {
    const result = await getFreshLocation(undefined);
    expect(result).toEqual({ ok: false, reason: "unsupported" });
  });

  it("resolves ok: true with a fix shaped for gpsFixInputSchema on success", async () => {
    const fake: GeolocationLike = {
      getCurrentPosition(success) {
        success({
          coords: { latitude: 40.1, longitude: -73.2, accuracy: 12 },
          timestamp: Date.parse("2026-08-13T18:00:00.000Z"),
        } as GeolocationPosition);
      },
    };

    const result = await getFreshLocation(fake);
    expect(result).toEqual({
      ok: true,
      fix: {
        latitude: 40.1,
        longitude: -73.2,
        accuracyM: 12,
        capturedAt: "2026-08-13T18:00:00.000Z",
      },
    });
  });

  it("always requests a fresh fix — never a cached one", async () => {
    let capturedOptions: PositionOptions | undefined;
    const fake: GeolocationLike = {
      getCurrentPosition(success, _error, options) {
        capturedOptions = options;
        success({
          coords: { latitude: 0, longitude: 0, accuracy: 1 },
          timestamp: Date.now(),
        } as GeolocationPosition);
      },
    };

    await getFreshLocation(fake);
    expect(capturedOptions?.maximumAge).toBe(0);
    expect(capturedOptions?.enableHighAccuracy).toBe(true);
  });

  it("resolves ok: false with the mapped reason on a permission denial", async () => {
    const fake: GeolocationLike = {
      getCurrentPosition(_success, error) {
        error({ code: 1, message: "denied" } as GeolocationPositionError);
      },
    };

    const result = await getFreshLocation(fake);
    expect(result).toEqual({ ok: false, reason: "permission-denied" });
  });

  it("never rejects — every path resolves, so a caller can never forget a .catch", async () => {
    const fake: GeolocationLike = {
      getCurrentPosition(_success, error) {
        error({ code: 2, message: "unavailable" } as GeolocationPositionError);
      },
    };

    await expect(getFreshLocation(fake)).resolves.toBeDefined();
  });
});
