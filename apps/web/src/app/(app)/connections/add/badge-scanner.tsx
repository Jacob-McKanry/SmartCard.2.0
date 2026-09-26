"use client";

import { useEffect, useRef, useState } from "react";

import { cameraDenialMessage, mapCameraErrorName, type CameraDenialReason } from "../../connect/lib/camera";
import { createFrameDecoder, type FrameDecoder } from "../../connect/scan/barcode-decoder";

/**
 * A live camera scan for a badge's QR code or barcode — the `badge_qr` input
 * mode of the unverified "add a contact" flow (2026-09-26,
 * docs/architecture/2026-09-26-unverified-connections.md).
 *
 * DELIBERATELY SIMPLER THAN `connect/scan/scanner-flow.tsx`, AND WHY THAT IS
 * CORRECT HERE RATHER THAN A SHORTCUT
 *
 * That component's `scanner-state.ts` reducer exists because the verified
 * connect flow has real security states to track precisely (camera denied,
 * scanning, verifying against a live session, location-denied, a server
 * refusal). This scanner has exactly one job: decode whatever QR/barcode is
 * in frame and hand the raw text to the caller once. There is no session to
 * verify against, no location gate, and no server round-trip from this
 * component at all — `add-contact-flow.tsx` (the caller) is what turns the
 * decoded text into pre-filled form fields via `extractContactGuess`, and
 * nothing here decides whether a connection is allowed. A five-state reducer
 * for "camera on, then call back once" would be machinery this screen has no
 * use for.
 *
 * Reuses `createFrameDecoder` (`connect/scan/barcode-decoder.ts`) and the
 * camera-permission handling (`connect/lib/camera.ts`) as-is — the SAME
 * decoder and the SAME error messages the verified QR scanner uses, since
 * "read a QR code from a camera frame" and "what to tell someone when the
 * camera won't start" are platform facts, not security-adjacent ones.
 *
 * UNLIKE THE VERIFIED SCANNER, THIS ONE DOES NOT CHECK THE DECODED TEXT'S
 * SHAPE AT ALL. A badge's QR/barcode can contain anything — a URL, a vCard,
 * a plain employee id — so every decoded string is handed to the caller
 * verbatim, whatever it looks like. There is no "that isn't a SmartCard
 * code" branch here, because there is no expected shape to hold it to.
 */

const SCAN_INTERVAL_MS = 300;

export function BadgeScanner({ onDecoded }: { onDecoded: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const decoderRef = useRef<FrameDecoder | null>(null);
  const [status, setStatus] = useState<
    { phase: "starting" } | { phase: "scanning" } | { phase: "denied"; reason: CameraDenialReason }
  >({ phase: "starting" });
  // Guards against dispatching onDecoded twice — the interval below can fire
  // again before its own `clearInterval` call takes effect.
  const decodedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    void (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setStatus({ phase: "denied", reason: "unsupported" });
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        decoderRef.current = createFrameDecoder();
        setStatus({ phase: "scanning" });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        setStatus({ phase: "denied", reason: mapCameraErrorName(name) });
      }
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (status.phase !== "scanning") return;
    const decoder = decoderRef.current;
    const video = videoRef.current;
    if (!decoder || !video) return;

    const intervalId = window.setInterval(() => {
      if (decodedRef.current) return;
      decoder
        .detect(video)
        .then((text) => {
          if (text === null || decodedRef.current) return;
          decodedRef.current = true;
          window.clearInterval(intervalId);
          onDecoded(text);
        })
        .catch(() => {
          // A transient decode failure is not a reason to stop scanning.
        });
    }, SCAN_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
    // `onDecoded` is passed fresh on every parent render in practice, but this
    // effect should only re-run when the scanning phase itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.phase]);

  if (status.phase === "denied") {
    return (
      <p className="text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
        {cameraDenialMessage(status.reason)}
      </p>
    );
  }

  return (
    <div
      className="relative mx-auto size-56 max-w-full overflow-hidden rounded-[26px]"
      style={{
        border: "1px solid var(--sc-glass-bd)",
        background: "repeating-linear-gradient(120deg,#2a3040 0 12px,#333a4d 12px 24px)",
      }}
    >
      <video ref={videoRef} muted playsInline className="size-full object-cover" />
      {status.phase === "starting" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p
            role="status"
            className="rounded-lg px-2.5 py-1.5 font-mono text-[11px] leading-4"
            style={{ background: "rgba(0,0,0,.4)", color: "rgba(255,255,255,.85)" }}
          >
            Starting the camera…
          </p>
        </div>
      )}
      <span
        aria-hidden
        className="absolute inset-[30px] rounded-[18px]"
        style={{ border: "2px solid rgba(255,255,255,.7)", boxShadow: "0 0 0 999px rgba(10,14,24,.28)" }}
      />
    </div>
  );
}
