"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reads an arbitrary NFC badge's text/URL records — the `badge_nfc` input
 * mode of the unverified "add a contact" flow (2026-09-26,
 * docs/architecture/2026-09-26-unverified-connections.md).
 *
 * NOT THE SAME MECHANISM AS THIS APP'S OWN NFC CARDS, DELIBERATELY
 *
 * SmartCard's own card-tap flow (`/card/[code]`) works because a SmartCard
 * card is a physical tag this product itself provisioned, written with a URL
 * this app controls — tapping it just opens that URL, no JavaScript NFC API
 * involved at all (see `nfc-verifier.ts`'s header). A tradeshow badge is
 * someone else's tag with unknown, arbitrary content, so there is nothing
 * for this app to "redeem" — the only thing possible is READING whatever the
 * badge's issuer wrote onto it, which is what the browser's Web NFC API
 * (`NDEFReader`) does. This component and SmartCard's own NFC connect flow
 * share nothing but the word "NFC".
 *
 * REAL, NARROW BROWSER SUPPORT — SURFACED HONESTLY, NOT PAPERED OVER
 *
 * Web NFC is implemented, at time of writing, only in Chrome for Android
 * over HTTPS, behind an explicit user gesture — not in Safari/iOS, not in
 * desktop browsers. `"NDEFReader" in window` feature-detects this
 * accurately; everywhere else, the unsupported message below is shown
 * immediately and no scan is attempted, rather than a button that silently
 * does nothing when tapped. Unverified in this sandbox: no NFC hardware, no
 * physical badge, and no Android Chrome browser available to test an actual
 * tap against.
 *
 * WHATEVER THE BADGE ENCODES IS HANDED TO THE CALLER VERBATIM — same posture
 * as `badge-scanner.tsx`'s QR/barcode reading: no attempt is made here to
 * validate or interpret the payload's shape. `add-contact-flow.tsx` runs the
 * same `extractContactGuess` over whatever text comes back.
 */

type NfcState =
  | { phase: "unsupported" }
  | { phase: "idle" }
  | { phase: "scanning" }
  | { phase: "error"; message: string };

function textFromRecord(record: NDEFRecord): string | null {
  if (record.data === undefined) return null;
  try {
    if (record.recordType === "url" || record.recordType === "text") {
      // Text records carry a status byte + optional language-code prefix per
      // the NDEF spec; a UTF-8 decode of the whole buffer is close enough for
      // the modest guess-extraction this feeds — this never claims to be a
      // spec-correct NDEF text-record parser.
      return new TextDecoder().decode(record.data.buffer);
    }
  } catch {
    return null;
  }
  return null;
}

export function NfcTap({ onRead }: { onRead: (text: string) => void }) {
  const [state, setState] = useState<NfcState>(() => ({
    phase: typeof window !== "undefined" && "NDEFReader" in window ? "idle" : "unsupported",
  }));
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function startScan() {
    if (typeof window === "undefined" || !("NDEFReader" in window)) {
      setState({ phase: "unsupported" });
      return;
    }
    setState({ phase: "scanning" });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const reader = new NDEFReader();
      reader.addEventListener("reading", (event: NDEFReadingEvent) => {
        const texts = event.message.records
          .map((record) => textFromRecord(record))
          .filter((text): text is string => text !== null);
        controller.abort();
        onRead(texts.join("\n"));
      });
      reader.addEventListener("readingerror", () => {
        setState({ phase: "error", message: "Couldn't read that badge. Try tapping it again." });
      });
      await reader.scan({ signal: controller.signal });
    } catch {
      setState({
        phase: "error",
        message: "Couldn't start NFC. Make sure NFC is turned on for this browser and try again.",
      });
    }
  }

  if (state.phase === "unsupported") {
    return (
      <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
        This browser doesn&rsquo;t support reading NFC badges (works on Chrome for Android today).
        Try scanning a QR code on the badge instead, or enter details manually.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      {state.phase === "idle" && (
        <button
          type="button"
          onClick={() => void startScan()}
          className="flex min-h-11 items-center justify-center rounded-full px-5 py-3 text-[14px] leading-[18px] font-semibold text-white"
          style={{
            background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
            boxShadow: "0 14px 30px -10px rgba(11,96,255,.55)",
          }}
        >
          Ready to tap
        </button>
      )}
      {state.phase === "scanning" && (
        <p role="status" className="text-[14px] leading-5" style={{ color: "var(--sc-text-muted)" }}>
          Hold the badge against the back of your phone…
        </p>
      )}
      {state.phase === "error" && (
        <>
          <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
            {state.message}
          </p>
          <button
            type="button"
            onClick={() => void startScan()}
            className="text-[13px] leading-[18px] font-semibold"
            style={{ color: "var(--sc-accent-deep)" }}
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}
