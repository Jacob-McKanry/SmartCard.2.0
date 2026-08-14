import { describe, expect, it } from "vitest";

import { pickDecodeStrategy } from "./barcode-decoder";

/**
 * Only the strategy SELECTION is tested here — see `barcode-decoder.ts`'s
 * header comment for why the actual frame-decoding logic (native
 * `BarcodeDetector` or `jsQR` against a canvas) is not: it needs a real
 * camera feed or synthetic video frames, neither of which this sandbox has.
 */
describe("pickDecodeStrategy", () => {
  it("prefers the native BarcodeDetector when the browser has one", () => {
    expect(pickDecodeStrategy({ hasBarcodeDetector: true })).toBe("native");
  });

  it("falls back to jsqr when it does not", () => {
    expect(pickDecodeStrategy({ hasBarcodeDetector: false })).toBe("jsqr");
  });
});
