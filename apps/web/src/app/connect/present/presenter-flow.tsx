"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { ConnectApiError, createQrSession, heartbeatQrSession } from "@smartcard/api-client";

import { Button } from "@/components/ui/button";

import { getOrCreateDeviceId } from "../lib/device-id";
import { getFreshLocation, locationDenialMessage } from "../lib/geolocation";
import { buildConnectUrl } from "../lib/qr-url";
import { initialPresenterState, presenterReducer } from "./presenter-state";
import {
  getWakeLock,
  releaseWakeLock,
  requestWakeLock,
  type WakeLockSentinelLike,
} from "./wake-lock";

/**
 * The presenter screen ("Show my code"), wired on top of `presenter-state.ts`.
 *
 * WHAT LIVES HERE VS. WHAT LIVES IN THE REDUCER
 * `presenter-state.ts` decides what the NEXT state is for a given event —
 * pure, DOM-free, unit-tested on its own. Everything in this file is the
 * other half: producing those events from real browser APIs (geolocation,
 * `fetch` via `@smartcard/api-client`, the Wake Lock API) and rendering each
 * phase. None of the decisions here are re-litigated in this component; it
 * only calls `dispatch` with what actually happened.
 *
 * WHY THIS IS A CLIENT COMPONENT
 * `packages/api-client/src/connect.ts`'s header explains why the create/
 * heartbeat loop is not a Server Action: geolocation and a rotation timer are
 * inherently client-side. `page.tsx` in this directory does the auth check
 * (Server Component, same pattern as `/profile`) and renders this component
 * only for a signed-in user — but see `readAuthenticatedRequest`'s own header
 * comment for why that page-level check is UX only, not the security
 * boundary; the boundary is `getAuthenticatedContext()` re-run inside every
 * `/api/connect/*` route on every request this component makes.
 */
export function PresenterFlow() {
  const [state, dispatch] = useReducer(presenterReducer, initialPresenterState);
  const wakeLockSentinelRef = useRef<WakeLockSentinelLike | null>(null);
  // `window.location.origin` is unavailable during SSR; the lazy initializer
  // resolves to `null` there and to the real origin on the client's first
  // render, with no effect needed to reconcile the two — the QR only ever
  // renders once `phase` reaches "active", which requires client-side
  // effects (the location fix, the session create) to have already
  // completed, so this can never be the value actually rendered during SSR.
  // See `qr-url.ts`'s header for why the origin, not a hardcoded domain, is
  // the right source for the URL it encodes.
  const [origin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : window.location.origin,
  );

  // ---------------------------------------------------------------------
  // requesting-location -> starting -> active
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (state.phase !== "requesting-location") return;

    let cancelled = false;
    void (async () => {
      const location = await getFreshLocation();
      if (cancelled) return;

      if (!location.ok) {
        dispatch({ type: "location-denied", reason: location.reason });
        return;
      }

      dispatch({ type: "starting" });
      try {
        const deviceId = getOrCreateDeviceId(window.localStorage);
        const session = await createQrSession({ deviceId });
        if (cancelled) return;
        dispatch({
          type: "session-started",
          sessionId: session.sessionId,
          token: session.token,
          rotateAfterSeconds: session.rotateAfterSeconds,
        });
      } catch (error) {
        if (cancelled) return;
        dispatch({ type: "failed", message: apiErrorMessage(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.phase]);

  // ---------------------------------------------------------------------
  // active -> active | connected | ended | location-denied | error
  //
  // One heartbeat per rotation, scheduled from the CURRENT state's own
  // `rotateAfterSeconds` and re-scheduled every time a fresh `active` state
  // arrives — so a server-side change to the rotation cadence takes effect
  // on the very next cycle rather than needing a hardcoded constant here.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (state.phase !== "active") return;
    const { sessionId, rotateAfterSeconds } = state;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const location = await getFreshLocation();
      if (cancelled) return;

      // A lost fix mid-session fails exactly the same way an initial denial
      // does (§4.3's fail-closed table applies throughout, not only at the
      // start) — never sent as a stale/cached fix, never silently retried
      // with no explanation.
      if (!location.ok) {
        dispatch({ type: "location-denied", reason: location.reason });
        return;
      }

      try {
        const response = await heartbeatQrSession({ sessionId, location: location.fix });
        if (cancelled) return;

        if (response.status === "active") {
          dispatch({
            type: "heartbeat-active",
            token: response.token,
            rotateAfterSeconds: response.rotateAfterSeconds,
          });
        } else if (response.status === "consumed") {
          dispatch({ type: "heartbeat-consumed" });
        } else {
          dispatch({ type: "heartbeat-ended" });
        }
      } catch (error) {
        if (cancelled) return;
        dispatch({ type: "failed", message: apiErrorMessage(error) });
      }
    }, rotateAfterSeconds * 1000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [state]);

  // ---------------------------------------------------------------------
  // Wake lock: held while a code is up (starting or active), released the
  // moment it isn't. Reacquired on visibility change because the platform
  // releases the lock automatically when the tab is hidden and there is no
  // event for "got it back" other than watching for it.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const showingCode = state.phase === "starting" || state.phase === "active";
    if (!showingCode) {
      void releaseWakeLock(wakeLockSentinelRef.current);
      wakeLockSentinelRef.current = null;
      return;
    }

    const wakeLock = getWakeLock();
    let cancelled = false;

    async function acquire() {
      const sentinel = await requestWakeLock(wakeLock);
      if (cancelled) {
        void releaseWakeLock(sentinel);
        return;
      }
      wakeLockSentinelRef.current = sentinel;
    }

    void acquire();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && wakeLockSentinelRef.current === null) {
        void acquire();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void releaseWakeLock(wakeLockSentinelRef.current);
      wakeLockSentinelRef.current = null;
    };
  }, [state.phase]);

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      {state.phase === "requesting-location" && <Status message="Getting your location…" />}

      {state.phase === "location-denied" && (
        <ErrorPanel
          message={locationDenialMessage(state.reason)}
          onRetry={() => dispatch({ type: "restart" })}
        />
      )}

      {state.phase === "starting" && <Status message="Setting up your code…" />}

      {state.phase === "active" && (
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-lg border bg-card p-4">
            <QRCodeSVG
              value={origin !== null ? buildConnectUrl(origin, state.token) : ""}
              size={240}
              level="M"
              marginSize={2}
            />
          </div>
          <p className="text-sm text-muted-foreground">Hold this up for them to scan.</p>
        </div>
      )}

      {state.phase === "connected" && (
        <div className="flex flex-col items-center gap-4">
          <h2 className="text-xl font-semibold">You&rsquo;re connected.</h2>
          <Button variant="outline" onClick={() => dispatch({ type: "restart" })}>
            Show another code
          </Button>
        </div>
      )}

      {state.phase === "ended" && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-muted-foreground">That code is no longer active.</p>
          <Button onClick={() => dispatch({ type: "restart" })}>Show a new code</Button>
        </div>
      )}

      {state.phase === "error" && (
        <ErrorPanel message={state.message} onRetry={() => dispatch({ type: "restart" })} />
      )}
    </div>
  );
}

/** Turns anything `createQrSession`/`heartbeatQrSession` can throw into user-facing text. */
function apiErrorMessage(error: unknown): string {
  return error instanceof ConnectApiError
    ? error.message
    : "Couldn't reach SmartCard. Check your connection and try again.";
}

function Status({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-destructive">{message}</p>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}
