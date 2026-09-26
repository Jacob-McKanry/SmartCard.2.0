import "server-only";

import { createWorker } from "tesseract.js";
import { extractContactGuess, type ContactGuess } from "@smartcard/core";

/**
 * OCR for the "scan a business card" input mode of the unverified "add a
 * contact" flow (2026-09-26, docs/architecture/2026-09-26-unverified-connections.md).
 *
 * WHY THIS RUNS SERVER-SIDE, NOT IN THE BROWSER
 *
 * `next.config.ts`'s Content-Security-Policy sets `connect-src 'self'` —
 * documented there as "the app makes NO cross-origin requests from the
 * browser." Tesseract.js's browser build fetches its WASM core and trained
 * language data from a CDN by default, which that policy would refuse
 * outright unless every one of those assets were vendored into this repo and
 * served same-origin. Running it here instead means the browser only ever
 * uploads a photo to this app's own server action — a same-origin request
 * the existing CSP already allows — and the CDN fetch (still real, still
 * happens) is server-to-server, which the browser's CSP has no opinion
 * about at all.
 *
 * A REAL, UNVERIFIED-IN-THIS-SANDBOX OPERATIONAL RISK, STATED PLAINLY RATHER
 * THAN GLOSSED OVER
 *
 * Tesseract.js's Node worker uses `worker_threads` (not `child_process` /
 * an external binary), which is compatible with Vercel's serverless
 * functions. It does still need to fetch the trained-language data
 * (`eng.traineddata`, a few MB) from a CDN on first use, and `cachePath`
 * below points that cache at `/tmp` — the one writable directory a Vercel
 * function has — but `/tmp` does not persist across cold starts, so a cold
 * function likely re-downloads that data on every cold start rather than
 * genuinely caching it. That means real, variable added latency (network
 * fetch + OCR pass) on top of whatever `next.config.ts`/Vercel's function
 * timeout allows, and it has NOT been exercised against a real Vercel
 * deployment or a real photographed card in this sandbox (no browser, no
 * camera, no live network path to test end-to-end). If this proves too slow
 * or unreliable in production, the two paths worth trying next are: vendor
 * `eng.traineddata` into the deployment so there is no cold-start fetch at
 * all, or move OCR to a dedicated long-running service / a hosted vision API
 * instead of a per-request serverless worker.
 *
 * Field-guessing itself (`extractContactGuess`) lives in `@smartcard/core`,
 * shared with the badge QR/barcode and NFC input modes — see that module's
 * header for why it is deliberately modest rather than a confident parser.
 */

export interface CardOcrResult {
  /** The full extracted text, for the UI to display so a person can read anything the guesses below missed. */
  rawText: string;
  /** Best-effort guesses, pre-filling the manual-entry form — never auto-submitted. */
  guess: ContactGuess;
}

/**
 * Runs OCR over a photographed card/badge and returns the raw text plus the
 * modest guesses `extractContactGuess` can make from it. Throws on a real
 * extraction failure (a corrupt image, a worker that never starts) — the
 * caller decides how to surface that; this function makes no attempt to
 * distinguish "found nothing" from "failed", both of which come back as
 * very short or empty `rawText`.
 */
export async function extractCardText(imageBytes: Buffer): Promise<CardOcrResult> {
  const worker = await createWorker("eng", 1, {
    cachePath: "/tmp",
  });

  try {
    const {
      data: { text },
    } = await worker.recognize(imageBytes);
    return { rawText: text, guess: extractContactGuess(text) };
  } finally {
    await worker.terminate();
  }
}
