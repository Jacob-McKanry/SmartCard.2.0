"use client";

import { useEffect, useReducer, useRef } from "react";

import { ConnectApiError, redeemQr } from "@smartcard/api-client";

import { Button } from "@/components/ui/button";

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
 */
export function ScannerFlow() {
  const [state, dispatch] = useReducer(scannerReducer, initialScannerState);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const decoderRef = useRef<FrameDecoder | null>(null);
  /**
   * `scanner-state.ts`'s `verifying` phase deliberately carries no payload
   * (see its header comment) — the token that triggered it lives here
   * instead, read by the verifying-phase effect below.
   */
  const pendingTokenRef = useRef<string | null>(null);

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

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      {/* The video element is mounted for the whole camera-ready lifetime
          (scanning, verifying, and every outcome after it) so the stream
          never has to be re-attached — only its visibility changes. */}
      <div className="relative overflow-hidden rounded-lg border bg-card">
        <video
          ref={videoRef}
          muted
          playsInline
          className={
            state.phase === "requesting-camera" || state.phase === "camera-denied"
              ? "hidden"
              : "aspect-square w-72 max-w-full object-cover"
          }
        />
        {state.phase === "scanning" && state.note && (
          <p className="absolute inset-x-0 bottom-0 bg-background/90 p-2 text-xs text-muted-foreground">
            {state.note}
          </p>
        )}
        {state.phase === "verifying" && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80">
            <p className="text-sm text-muted-foreground">Confirming…</p>
          </div>
        )}
      </div>

      {state.phase === "requesting-camera" && <Status message="Starting the camera…" />}

      {state.phase === "camera-denied" && (
        <ErrorPanel
          message={cameraDenialMessage(state.reason)}
          onRetry={() => window.location.reload()}
          retryLabel="Reload"
        />
      )}

      {state.phase === "scanning" && (
        <p className="text-sm text-muted-foreground">Point your camera at their code.</p>
      )}

      {state.phase === "location-denied" && (
        <ErrorPanel
          message={locationDenialMessage(state.reason)}
          onRetry={() => dispatch({ type: "scan-again" })}
        />
      )}

      {state.phase === "success" && (
        <div className="flex flex-col items-center gap-4">
          <h2 className="text-xl font-semibold">You&rsquo;re connected.</h2>
          <Button variant="outline" onClick={() => dispatch({ type: "scan-again" })}>
            Scan another
          </Button>
        </div>
      )}

      {state.phase === "failure" && (
        <ErrorPanel message={state.message} onRetry={() => dispatch({ type: "scan-again" })} />
      )}

      {state.phase === "error" && (
        <ErrorPanel message={state.message} onRetry={() => dispatch({ type: "scan-again" })} />
      )}
    </div>
  );
}

/** Turns anything `redeemQr` can throw (or `null` for the defensive no-token path) into user-facing text. */
function apiErrorMessage(error: unknown): string {
  return error instanceof ConnectApiError
    ? error.message
    : "Couldn't reach SmartCard. Check your connection and try again.";
}

function Status({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}

function ErrorPanel({
  message,
  onRetry,
  retryLabel = "Try again",
}: {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-destructive">{message}</p>
      <Button onClick={onRetry}>{retryLabel}</Button>
    </div>
  );
}
