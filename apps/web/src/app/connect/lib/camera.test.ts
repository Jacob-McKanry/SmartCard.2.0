import { describe, expect, it } from "vitest";

import { cameraDenialMessage, mapCameraErrorName } from "./camera";

describe("mapCameraErrorName", () => {
  it("maps NotAllowedError and SecurityError to permission-denied", () => {
    expect(mapCameraErrorName("NotAllowedError")).toBe("permission-denied");
    expect(mapCameraErrorName("SecurityError")).toBe("permission-denied");
  });

  it("maps NotFoundError and OverconstrainedError to not-found", () => {
    expect(mapCameraErrorName("NotFoundError")).toBe("not-found");
    expect(mapCameraErrorName("OverconstrainedError")).toBe("not-found");
  });

  it("falls back to other for anything unrecognised, never throwing", () => {
    expect(mapCameraErrorName("SomeWeirdError")).toBe("other");
    expect(mapCameraErrorName("")).toBe("other");
  });
});

describe("cameraDenialMessage", () => {
  it("gives every reason its own non-empty explanation", () => {
    for (const reason of ["permission-denied", "not-found", "unsupported", "other"] as const) {
      expect(cameraDenialMessage(reason).length).toBeGreaterThan(0);
    }
  });
});
