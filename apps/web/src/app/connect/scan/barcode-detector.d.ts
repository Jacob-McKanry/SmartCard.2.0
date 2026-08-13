/**
 * Minimal ambient types for the Shape Detection API's `BarcodeDetector`.
 *
 * Not in TypeScript's bundled `lib.dom.d.ts` as of the version pinned in this
 * repo (checked: `node_modules/typescript/lib/lib.dom.d.ts` has no match),
 * even though the API itself is implemented in Chromium-based browsers.
 * Declared here, scoped to exactly the surface `barcode-decoder.ts` uses,
 * rather than reaching for `any` at the call site — see that file for the
 * feature-detection (`"BarcodeDetector" in window`) that guards every use of
 * this type against the browsers (Safari, Firefox, at time of writing) that
 * don't implement it.
 */

interface DetectedBarcode {
  readonly rawValue: string;
}

interface BarcodeDetectorOptions {
  formats?: string[];
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(image: CanvasImageSource): Promise<DetectedBarcode[]>;
}
