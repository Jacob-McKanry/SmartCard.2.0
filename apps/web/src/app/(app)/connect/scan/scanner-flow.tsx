"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import { ConnectApiError, redeemQr } from "@smartcard/api-client";

import { ConnectedPayoff, type PayoffViewer } from "../connected-payoff";
import { QuietOutcome } from "../lib/connect-ui";
import { getOrCreateDeviceId } from "../lib/device-id";
import { getFreshLocation, locationDenialMessage } from "../lib/geolocation";
import { parseConnectToken } from "../lib/qr-url";
import { cameraDenialMessage, mapCameraErrorName } from "../lib/camera";
import { createFrameDecoder, type FrameDecoder } from "./barcode-decoder";
import { initialScannerState, scannerReducer } from "./scanner-state";

/** How often a frame is pulled off the video element and checked for a code. */
const SCAN_INTERVAL_MS = 300;

/**
 * The scanner screen ("Scan a code"), wired on top of `scanner-state.ts`.
 *
 * Same split as `presenter-flow.tsx`: `scanner-state.ts` owns what state
 * comes next for a given event, DOM-free and unit-tested on its own; this
 * file owns turning real browser APIs (camera, the decode loop, geolocation,
 * `redeemQr`) into those events, and rendering each phase.
 *
 * THE CAMERA STREAM OUTLIVES ANY SINGLE SCAN
 * Permission is requested once, on mount. A non-matching code, a rejection, a
 * transport error, or a successful redeem all return to `scanning` without
 * tearing the stream down and asking again — the task's "scan again" is a
 * state transition, not a new permission prompt. The stream is only stopped
 * on `camera-denied` (nothing to stop) or on unmount.
 *
 * `viewer` is the signed-in person's own initials and photo, resolved on the
 * server by `../page.tsx`, used only to draw their side of the success
 * payoff's two-disc flourish. It is never sent anywhere.
 */
export function ScannerFlow({ viewer }: { viewer: PayoffViewer }) {
  const [state, dispatch] = useReducer(scannerReducer, initialScannerState);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const decoderRef = useRef<FrameDecoder | null>(null);
  /**
   * `scanner-state.ts`'s `verifying` phase deliberately carries no payload
   * (see its header comment) — the token that triggered it lives here
   * instead, read by the verifying-phase effect below.
   */
  const pendingTokenRef = useRef<string | null>(null);
  /**
   * The connection a successful redeem created — the one thing the payoff
   * needs that the reducer does not carry.
   *
   * It lives in component state rather than in `scanner-state.ts` for the
   * same reason `pendingTokenRef` does: that machine's `success` phase is
   * deliberately payload-free and is pinned that way by
   * `scanner-state.test.ts`, and widening a tested state machine for a
   * presentational need is the wrong trade. It is `useState` rather than a
   * ref because it is read during render, which a ref may not be.
   *
   * Set immediately before the `redeem-success` dispatch (both updates batch
   * into the same render, so the success branch never paints without it), and
   * cleared on "scan again" so a second scan can never show the first scan's
   * meeting record.
   */
  const [connectionId, setConnectionId] = useState<string | null>(null);

  // ---------------------------------------------------------------------
  // requesting-camera -> camera-ready | camera-denied. Runs once.
  // ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    void (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        dispatch({ type: "camera-denied", reason: "unsupported" });
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
        dispatch({ type: "camera-ready" });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        dispatch({ type: "camera-denied", reason: mapCameraErrorName(name) });
      }
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // ---------------------------------------------------------------------
  // scanning: pull frames off the video element and look for a code.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (state.phase !== "scanning") return;
    const decoder = decoderRef.current;
    const video = videoRef.current;
    if (!decoder || !video) return;

    // The camera stage is hidden (not unmounted) while an outcome is on
    // screen, and a `display:none` video is allowed to be suspended by the
    // browser. Nudging it back before the decode loop starts is what keeps
    // "scan again" from returning to a viewfinder that is a frozen frame —
    // which would look exactly like a camera that works and a code that
    // never scans. Harmless when it is already playing.
    if (video.paused) {
      void video.play().catch(() => {
        // Nothing to recover here: if the element refuses to resume, the
        // decode loop below simply finds no code, which is the same as
        // pointing at nothing.
      });
    }

    let cancelled = false;
    let busy = false;

    const intervalId = window.setInterval(() => {
      if (busy || cancelled) return;
      busy = true;
      decoder
        .detect(video)
        .then((text) => {
          if (cancelled || text === null) return;

          const token = parseConnectToken(text, window.location.origin);
          if (token === null) {
            // Task requirement: something that isn't a SmartCard code is
            // handled gracefully, not as a connect failure — scanning
            // continues.
            dispatch({ type: "code-ignored" });
            return;
          }

          pendingTokenRef.current = token;
          dispatch({ type: "code-detected" });
        })
        .catch(() => {
          // A transient decode failure is not a reason to stop scanning.
        })
        .finally(() => {
          busy = false;
        });
    }, SCAN_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [state.phase]);

  // ---------------------------------------------------------------------
  // verifying: a fresh (never cached) location fix, then redeem.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (state.phase !== "verifying") return;

    let cancelled = false;
    void (async () => {
      const location = await getFreshLocation();
      if (cancelled) return;

      if (!location.ok) {
        dispatch({ type: "location-denied", reason: location.reason });
        return;
      }

      const token = pendingTokenRef.current;
      if (token === null) {
        // Defensive only — `code-detected` is never dispatched without first
        // setting this ref. Fails closed rather than redeeming a stale or
        // absent token.
        dispatch({ type: "failed", message: apiErrorMessage(null) });
        return;
      }

      try {
        const deviceId = getOrCreateDeviceId(window.localStorage);
        const response = await redeemQr({ token, scannerLocation: location.fix, deviceId });
        if (cancelled) return;

        if (response.ok) {
          setConnectionId(response.connectionId);
          dispatch({ type: "redeem-success" });
        } else {
          // The API's own message, verbatim — never a distance, a reason
          // code, or anything this screen adds on top (§4.2 step 7).
          dispatch({ type: "redeem-failure", message: response.message });
        }
      } catch (error) {
        if (cancelled) return;
        dispatch({ type: "failed", message: apiErrorMessage(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.phase]);

  function scanAgain() {
    // Cleared before the state change so the payoff can never re-mount
    // holding the previous scan's connection.
    setConnectionId(null);
    dispatch({ type: "scan-again" });
  }

  // The camera stage stays mounted through every phase (see the header: the
  // stream outlives any single scan) but is hidden once an outcome is on
  // screen, so the payoff or the refusal is the only thing being looked at.
  const stageVisible =
    state.phase === "requesting-camera" || state.phase === "scanning" || state.phase === "verifying";

  return (
    <div className="flex w-full flex-col items-center gap-[18px]">
      {state.phase === "scanning" && (
        <p className="text-center text-[14px] leading-5" style={{ color: "var(--sc-text-muted)" }}>
          Point your camera at the code they&rsquo;re showing.
        </p>
      )}

      <div
        className={stageVisible ? "relative size-72 max-w-full overflow-hidden rounded-[34px]" : "hidden"}
        style={{
          border: "1px solid var(--sc-glass-bd)",
          boxShadow: "0 22px 50px -18px rgba(16,24,40,.4)",
          background: "repeating-linear-gradient(120deg,#2a3040 0 12px,#333a4d 12px 24px)",
        }}
      >
        <video ref={videoRef} muted playsInline className="size-full object-cover" />

        {/*
         * The reticle: a rounded window inset 38px, with a huge spread shadow
         * standing in for a dimmed surround, plus the travelling scanline.
         * Purely decorative — nothing about where a code must sit in frame is
         * enforced here; `barcode-decoder.ts` reads the whole frame.
         */}
        <span
          aria-hidden
          className="absolute inset-[38px] rounded-[22px]"
          style={{
            border: "2px solid rgba(255,255,255,.7)",
            boxShadow: "0 0 0 999px rgba(10,14,24,.28)",
          }}
        />
        <span
          aria-hidden
          className="absolute top-[38px] right-[38px] left-[38px] h-0.5"
          style={{
            background: "linear-gradient(90deg, transparent, var(--sc-accent), transparent)",
            animation: "sc-scanline 2.6s cubic-bezier(.4,0,.6,1) infinite",
          }}
        />

        {state.phase === "requesting-camera" && (
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

        {/*
         * "That isn't a SmartCard code" is explicitly NOT a failure (see
         * `scanner-state.ts`): the loop never pauses, so this is a note over
         * a live viewfinder rather than an outcome panel.
         */}
        {state.phase === "scanning" && state.note && (
          <p
            role="status"
            className="absolute inset-x-0 bottom-0 px-4 py-2.5 text-center text-[12px] leading-4"
            style={{ background: "rgba(10,14,24,.62)", color: "rgba(255,255,255,.9)" }}
          >
            {state.note}
          </p>
        )}

        {state.phase === "verifying" && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "rgba(10,14,24,.55)" }}
          >
            <p role="status" className="text-[14px] leading-5 font-medium text-white">
              Confirming…
            </p>
          </div>
        )}
      </div>

      {state.phase === "camera-denied" && (
        <QuietOutcome
          message={cameraDenialMessage(state.reason)}
          onRetry={() => window.location.reload()}
          retryLabel="Reload"
        />
      )}

      {state.phase === "location-denied" && (
        <QuietOutcome message={locationDenialMessage(state.reason)} onRetry={scanAgain} />
      )}

      {state.phase === "success" && (
        <ConnectedPayoff
          viewer={viewer}
          connectionId={connectionId}
          onAgain={scanAgain}
          againLabel="Connect again"
        />
      )}

      {/*
       * `failure` is the API's own refusal and `error` is a transport
       * problem, and they render identically on purpose — see
       * `QuietOutcome`'s header. The message is passed through untouched:
       * nothing is appended, no icon varies, no code is shown.
       */}
      {state.phase === "failure" && <QuietOutcome message={state.message} onRetry={scanAgain} />}

      {state.phase === "error" && <QuietOutcome message={state.message} onRetry={scanAgain} />}
    </div>
  );
}

/** Turns anything `redeemQr` can throw (or `null` for the defensive no-token path) into user-facing text. */
function apiErrorMessage(error: unknown): string {
  return error instanceof ConnectApiError
    ? error.message
    : "Couldn't reach SmartCard. Check your connection and try again.";
}
