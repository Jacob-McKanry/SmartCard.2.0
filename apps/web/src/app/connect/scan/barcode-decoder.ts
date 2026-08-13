import jsQR from "jsqr";

/**
 * Decodes QR codes from live camera frames.
 *
 * TWO STRATEGIES, CHOSEN ONCE PER SCANNER SESSION
 *
 *  - `native`: the browser's own `BarcodeDetector` (Shape Detection API).
 *    Zero bundle cost, hardware-accelerated where the platform provides it,
 *    and it can detect straight off the `<video>` element with no manual
 *    frame-grabbing. Supported in Chromium-based browsers (desktop Chrome/
 *    Edge, Android Chrome) at time of writing.
 *
 *  - `jsqr`: a small (~29KB), dependency-free, pure-JS QR decoder — chosen as
 *    the fallback because it needs nothing from the platform beyond 2D canvas
 *    (`CanvasRenderingContext2D.getImageData`), which is universal, so it
 *    covers exactly the browsers `BarcodeDetector` does not (notably Safari/
 *    iOS, which matters here since a private social app's user base skews
 *    toward phones). It has been the de facto standard vanilla-JS QR decoder
 *    for years, which is the property that matters most for a dependency
 *    sitting on the scan path of a security-relevant flow: well-understood
 *    failure modes, not novelty.
 *
 * `pickDecodeStrategy` is a pure function specifically so the SELECTION logic
 * is unit-tested (`barcode-decoder.test.ts`). The rest of this file — actually
 * pulling frames off a `<video>` element and running a decoder over them — is
 * not: it needs a real camera feed or a synthetic one, and this sandbox has
 * neither (see the build report for what was and wasn't testable here).
 *
 * NEITHER STRATEGY IS A SECURITY BOUNDARY. Decoding only recovers the text a
 * QR code encodes; `qr-url.ts` then checks whether that text is shaped like
 * one of our connect URLs, and the `qr/redeem` route is what actually
 * verifies the token inside it. A bug in decoding can at worst produce wrong
 * or garbled text, which fails the shape check or the server's HMAC check —
 * never a way to bypass either.
 */

export type DecodeStrategy = "native" | "jsqr";

export function pickDecodeStrategy(env: { hasBarcodeDetector: boolean }): DecodeStrategy {
  return env.hasBarcodeDetector ? "native" : "jsqr";
}

export interface FrameDecoder {
  readonly strategy: DecodeStrategy;
  /** Looks for a QR code in the video element's CURRENT frame. Null when none is found. */
  detect(video: HTMLVideoElement): Promise<string | null>;
}

function hasNativeBarcodeDetector(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

function createNativeDecoder(): FrameDecoder {
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  return {
    strategy: "native",
    async detect(video) {
      try {
        const codes = await detector.detect(video);
        return codes[0]?.rawValue ?? null;
      } catch {
        // A transient detector failure (e.g. a frame mid-transition) is not
        // a reason to stop scanning — the next tick tries again.
        return null;
      }
    },
  };
}

function createJsQrDecoder(): FrameDecoder {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  return {
    strategy: "jsqr",
    async detect(video) {
      if (ctx === null || video.videoWidth === 0 || video.videoHeight === 0) {
        return null;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
      return result?.data ?? null;
    },
  };
}

/** Picks a strategy for the current browser and returns a ready-to-use decoder. */
export function createFrameDecoder(): FrameDecoder {
  const strategy = pickDecodeStrategy({ hasBarcodeDetector: hasNativeBarcodeDetector() });
  return strategy === "native" ? createNativeDecoder() : createJsQrDecoder();
}
