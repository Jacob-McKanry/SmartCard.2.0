"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { ConnectApiError, createQrSession, heartbeatQrSession } from "@smartcard/api-client";

import { ConnectedPayoff, type PayoffViewer } from "../connected-payoff";
import { QuietOutcome, StatusLine } from "../lib/connect-ui";
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
 * How long the code stays faded out before the new one is swapped in. Matches
 * the CSS transition below, and the prototype's own 560ms — see the
 * cross-fade comment in the component.
 */
const QR_CROSSFADE_MS = 560;

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
 *
 * `viewer` is the signed-in person's own initials and photo, resolved on the
 * server by `../page.tsx` and passed down purely so the success payoff can
 * draw their side of the two-disc flourish. It is presentation data about the
 * caller themselves and is never sent anywhere.
 */
export function PresenterFlow({ viewer }: { viewer: PayoffViewer }) {
  const [state, dispatch] = useReducer(presenterReducer, initialPresenterState);
  const wakeLockSentinelRef = useRef<WakeLockSentinelLike | null>(null);
  /**
   * Identifies the one session-creation attempt whose result is still allowed
   * to be dispatched. Bumped when a new attempt starts, and on unmount. See
   * the long comment on the requesting-location effect below for why this is a
   * ref rather than the usual `cancelled` flag set from an effect cleanup.
   */
  const sessionAttemptRef = useRef(0);
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
  /**
   * The token currently being faded out, or null. Set by the heartbeat effect
   * the moment it learns a rotation happened, and never cleared: the dim is
   * applied only while it still *equals* the token on screen, so the
   * subsequent dispatch of the new token releases it automatically. That is
   * deliberate — a separate "clear the flag" step is the thing that would
   * strand the plate at 12% opacity if a session ended mid-fade, and tokens
   * are unique so a leftover value can never match a later one.
   */
  const [fadingToken, setFadingToken] = useState<string | null>(null);
  const dimmed = state.phase === "active" && fadingToken === state.token;

  // ---------------------------------------------------------------------
  // requesting-location -> starting -> active
  //
  // WHY THIS DOESN'T USE THE USUAL `cancelled` CLEANUP FLAG
  // This effect dispatches `starting` PARTWAY THROUGH its own async sequence
  // and then keeps working (`createQrSession`). Its dependency is
  // `state.phase`, so that dispatch changes this effect's own dependency —
  // React therefore tears this very instance down, running its cleanup, while
  // its `createQrSession` call is still in flight. The usual
  // `let cancelled = false; return () => { cancelled = true; };` pattern reads
  // as "a newer attempt has taken over, drop what you were doing", but here it
  // fired for a phase change this instance caused ON PURPOSE. In production
  // that meant: the session was created (the API returned 201), the
  // `session-started` dispatch that renders the QR was then dropped by
  // `if (cancelled) return`, and the screen sat on "Setting up your code…"
  // forever with nothing thrown and nothing logged. The `failed` dispatch in
  // the catch below was swallowed by the same race, so a create that actually
  // failed hung on that message too instead of showing the error panel.
  //
  // The ref pulls apart the two different questions the old flag was being
  // asked to answer at once:
  //   - "has a NEWER attempt started?" — the only thing that should ever
  //     invalidate work already in flight, and the only thing the ref tracks.
  //     It changes when an attempt actually begins, which is when this effect
  //     runs AND the phase is `requesting-location`: the initial mount, or a
  //     genuine `restart` from "Try again" / "Show a new code". That is why
  //     the dependency array stays `[state.phase]` — a real restart must still
  //     cancel a truly stale attempt, and it does.
  //   - "did `state.phase` change at all?" — also true for this effect's own
  //     `starting` dispatch, which is an expected step of the sequence and was
  //     never a reason to abandon it.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (state.phase !== "requesting-location") return;

    sessionAttemptRef.current += 1;
    const attempt = sessionAttemptRef.current;
    const isCurrentAttempt = () => sessionAttemptRef.current === attempt;

    void (async () => {
      const location = await getFreshLocation();
      if (!isCurrentAttempt()) return;

      if (!location.ok) {
        dispatch({ type: "location-denied", reason: location.reason });
        return;
      }

      dispatch({ type: "starting" });
      try {
        const deviceId = getOrCreateDeviceId(window.localStorage);
        const session = await createQrSession({ deviceId });
        if (!isCurrentAttempt()) return;
        dispatch({
          type: "session-started",
          sessionId: session.sessionId,
          token: session.token,
          rotateAfterSeconds: session.rotateAfterSeconds,
        });
      } catch (error) {
        if (!isCurrentAttempt()) return;
        dispatch({ type: "failed", message: apiErrorMessage(error) });
      }
    })();
  }, [state.phase]);

  // Unmount is the one other thing that invalidates an in-flight attempt:
  // leaving the screen should not dispatch a session into a component that is
  // gone. It needs its own `[]` effect because the attempt guard above
  // deliberately does not hang off the phase-keyed effect's cleanup — that
  // cleanup also runs on this component's own phase transitions, which is the
  // whole bug. This cleanup only ever runs on unmount.
  useEffect(() => {
    return () => {
      sessionAttemptRef.current += 1;
    };
  }, []);

  // ---------------------------------------------------------------------
  // active -> active | connected | ended | location-denied | error
  //
  // One heartbeat per rotation, scheduled from the CURRENT state's own
  // `rotateAfterSeconds` and re-scheduled every time a fresh `active` state
  // arrives — so a server-side change to the rotation cadence takes effect
  // on the very next cycle rather than needing a hardcoded constant here.
  //
  // THE ROTATION CROSS-FADE IS DRIVEN FROM HERE, NOT FROM A SEPARATE EFFECT
  //
  // DESIGN.md §6: "Rotation is a soft cross-fade (opacity to .12 +
  // blur(7px), swap, back) — never a hard cut." The swap has to happen at the
  // *bottom* of the fade, while the code is unreadable; that is what makes it
  // a cross-fade rather than a flicker. This is the one place that knows a
  // rotation has actually happened, so it is where the fade is sequenced:
  // dim, wait, then dispatch the new token. Everything below runs inside an
  // async callback, so there is no synchronous state update in an effect body
  // and no second effect racing this one to decide what is on screen.
  //
  // A heartbeat legitimately returns the SAME token when rotation is not yet
  // due; that dispatches straight through with no fade, which is why the
  // comparison is on the value rather than on "a heartbeat arrived".
  //
  // WHAT IS BRIEFLY ON SCREEN, AND WHY IT IS SAFE. For the ~560ms of the
  // fade the superseded token is still displayed, at 12% opacity behind a 7px
  // blur — unreadable by a camera, which is the point of fading rather than
  // cutting. Even if one were read, this fails closed: the server has already
  // rotated the nonce, so redeeming it is a `nonce_mismatch` rejection like
  // any other, answered with the same generic refusal as everything else.
  // Nothing here can turn a superseded token into a connection.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (state.phase !== "active") return;
    const { sessionId, rotateAfterSeconds, token: currentToken } = state;

    let cancelled = false;
    let fadeTimer: number | undefined;

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
          const next = {
            type: "heartbeat-active",
            token: response.token,
            rotateAfterSeconds: response.rotateAfterSeconds,
          } as const;

          if (response.token === currentToken) {
            dispatch(next);
            return;
          }

          setFadingToken(currentToken);
          fadeTimer = window.setTimeout(() => {
            if (cancelled) return;
            dispatch(next);
          }, QR_CROSSFADE_MS);
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
      if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);
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
    <div className="flex w-full flex-col items-center gap-[18px]">
      {state.phase === "requesting-location" && <StatusLine message="Getting your location…" />}

      {state.phase === "location-denied" && (
        <QuietOutcome
          message={locationDenialMessage(state.reason)}
          onRetry={() => dispatch({ type: "restart" })}
        />
      )}

      {state.phase === "starting" && <StatusLine message="Setting up your code…" />}

      {state.phase === "active" && (
        <>
          <p
            className="text-center text-[14px] leading-5"
            style={{ color: "var(--sc-text-muted)" }}
          >
            Have the other person scan this with SmartCard.
          </p>

          {/*
           * The glass plate, its breathing halo, and the white QR card
           * inside it — §6's "QR in a white plate inside a glass card with a
           * breathing halo". The halo sits at `z-index:-1` and is inset
           * *outward*, so what is visible is the glow spilling past the
           * card's edge; the card's own background covers the rest.
           */}
          <div
            className="relative rounded-[34px] p-5"
            style={{
              background: "var(--sc-glass-bg)",
              backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
              WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
              border: "1px solid var(--sc-glass-bd)",
              boxShadow: "0 26px 60px -20px rgba(11,96,255,.35), 0 4px 14px rgba(16,24,40,.08)",
            }}
          >
            <span
              aria-hidden
              className="absolute rounded-[50px]"
              style={{
                inset: -26,
                zIndex: -1,
                background:
                  "radial-gradient(circle at 50% 50%, var(--sc-accent-tint), transparent 70%)",
                animation: "sc-halo 4.5s ease-in-out infinite",
              }}
            />
            <div
              className="flex size-[248px] items-center justify-center rounded-[22px] bg-white p-3.5"
              style={{
                opacity: dimmed ? 0.12 : 1,
                filter: dimmed ? "blur(7px)" : "blur(0px)",
                transition: "opacity .55s var(--sc-ease-glide), filter .55s var(--sc-ease-glide)",
              }}
            >
              <QRCodeSVG
                value={origin !== null ? buildConnectUrl(origin, state.token) : ""}
                size={220}
                level="M"
                marginSize={2}
              />
            </div>
          </div>

          <p
            className="flex items-center gap-2 text-[12px] leading-4 font-medium"
            style={{ color: "var(--sc-text-subtle)" }}
          >
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ background: "var(--sc-accent)", animation: "sc-halo 2s ease-in-out infinite" }}
            />
            Code refreshes on its own — nothing to tap
          </p>
        </>
      )}

      {state.phase === "connected" && (
        // No `connectionId`: the heartbeat that produced this state carries
        // only `status: "consumed"`. See `connected-payoff.tsx`'s header.
        <ConnectedPayoff
          viewer={viewer}
          connectionId={null}
          onAgain={() => dispatch({ type: "restart" })}
          againLabel="Show another code"
        />
      )}

      {state.phase === "ended" && (
        <QuietOutcome
          message="That code is no longer active."
          onRetry={() => dispatch({ type: "restart" })}
          retryLabel="Show a new code"
        />
      )}

      {state.phase === "error" && (
        <QuietOutcome message={state.message} onRetry={() => dispatch({ type: "restart" })} />
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
