import { describe, expect, it } from "vitest";

import { targetDimensions } from "./compress-image";

/**
 * `targetDimensions` is the one piece of `compress-image.ts` that is pure
 * logic rather than a browser API call — this test suite covers exactly
 * that function. The actual decode/canvas/encode path
 * (`compressImageForUpload`) needs `createImageBitmap` and `<canvas>`,
 * neither of which exists in this project's Node test environment (see
 * `vitest.config.ts`'s own header on why there is no jsdom here) — the same
 * boundary this codebase already draws around other browser-only modules.
 */
describe("targetDimensions", () => {
  it("leaves an image within the cap untouched", () => {
    expect(targetDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("leaves an image exactly at the cap untouched", () => {
    expect(targetDimensions(1600, 1200, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales down a landscape image by its long edge", () => {
    expect(targetDimensions(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales down a portrait image by its long edge", () => {
    expect(targetDimensions(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("scales down a square image", () => {
    expect(targetDimensions(5000, 5000, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it("never upscales a small image", () => {
    expect(targetDimensions(200, 100, 1600)).toEqual({ width: 200, height: 100 });
  });

  it("never produces a zero dimension for an extreme aspect ratio", () => {
    const result = targetDimensions(10000, 1, 1600);
    expect(result.width).toBe(1600);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});
