"use client";

import { useEffect, useReducer, useRef } from "react";

import { ConnectApiError, attachNfcLocation, redeemNfc } from "@smartcard/api-client";

import { Button } from "@/components/ui/button";

import { getFreshLocation } from "../../(app)/connect/lib/geolocation";
import { ClaimCardButton } from "./claim-card-button";
import { initialRedeemState, redeemReducer } from "./redeem-state";

/**
 * The card-tap redeem screen ("you just tapped a SmartCard"), wired on top
 * of `redeem-state.ts`. Sibling to `scanner-flow.tsx` (`/connect/scan`) —
 * same split between DOM-free state and the browser-facing effects that
 * drive it — but built around one call instead of a camera/GPS loop, per
 * §4.5 step 2: NFC's few-centimetre read range already IS the proximity
 * proof, so there is nothing here to gate on location.
 *
 * AUTO-TRIGGERS ON MOUNT, NO BUTTON PRESS
 * `code` comes from the URL's dynamic segment (`/card/[code]`) — the exact
 * value physically encoded on the tag (§2.2) — and the redeem effect below
 * fires the instant this component mounts, because the entire product value
 * of a physical tap is that it costs nothing beyond the tap itself. A button
 * press here would be the confirmation step §4.5's amendment (Q17) already
 * rejected, reintroduced as a UI affordance instead of a schema field.
 *
 * THE API'S OWN MESSAGE, VERBATIM — SAME RULE AS SCAN
 * `response.message` on a rejection is shown exactly as `userFacingMessage()`
 * produced it server-side (`packages/core/src/connect/user-messages.ts`).
 * This screen never appends a reason, a card detail, or anything else the
 * API did not return — §4.2 step 7's reasoning (never let a rejection leak
 * more than "it didn't work") applies to this path exactly as it does to
 * QR's.
 *
 * ===========================================================================
 * THE LOCATION IS FETCHED ALONGSIDE THE REDEEM, NEVER BEFORE IT (2026-08-28)
 * ===========================================================================
 * §4.5's amendment lets a tap record where it happened, for display only —
 * a "met at ___" label and the profile's city history, the same things a QR
 * meeting already gets. The constraint that shapes how, and the one to
 * preserve against any future edit, is the paragraph above: THE REDEEM MUST
 * NOT WAIT FOR ANYTHING. A GPS acquisition takes seconds and routinely fails
 * indoors, which is exactly where cards get handed over.
 *
 * So `getFreshLocation()` is kicked off in the SAME tick as `redeemNfc`, and
 * neither awaits the other. The redeem resolves and the screen says
 * "You're connected" on precisely the timeline it always did — the location
 * request is still in flight at that point and cannot delay it, because
 * nothing on the success path reads it. When (and only when) both the fix and
 * the `meetingId` have landed, a second call attaches one to the other.
 *
 * EVERY FAILURE ON THE LOCATION SIDE IS SILENT, AND THAT IS DELIBERATE.
 * Denied permission, a timeout, no signal, a refused attach, an offline
 * second request: all of them mean one absent place name on a connection
 * that already succeeded. There is nothing the person could do about any of
 * them and nothing they need told — §2.4 already treats a missing
 * `place_label` as "a cosmetic loss, not a security one", and this is the
 * same loss one step earlier. Surfacing it would report a failure about a
 * tap that worked.
 *
 * NOTE THE ASYMMETRY WITH `/connect/scan`, WHICH IS NOT AN INCONSISTENCY.
 * There, a denied location is a hard stop with an explanation, because the
 * QR path's GPS fix IS the proximity gate — no fix, no connection (§4.3's
 * fail-closed table). Here it gates nothing, so failing closed would mean
 * refusing a connection the tap itself already proved.
 */
export function CardRedeemFlow({ code }: { code: string }) {
  const [state, dispatch] = useReducer(redeemReducer, initialRedeemState);
  /**
   * The in-flight location request, started in the same tick as the redeem.
   * A ref rather than state because nothing renders from it and settling it
   * must not cause a re-render — it is a side channel that joins back up
   * only once the redeem has produced a `meetingId`.
   */
  const locationRef = useRef<ReturnType<typeof getFreshLocation> | null>(null);

  useEffect(() => {
    if (state.phase !== "verifying") return;

    let cancelled = false;

    // Started FIRST but awaited nowhere near here — see the header. A retry
    // re-enters `verifying` and starts a fresh one, which is correct: the
    // previous attempt's fix may be minutes old by then, and the attach
    // window would reject it anyway.
    locationRef.current = getFreshLocation();

    void (async () => {
      try {
        const response = await redeemNfc({ code });
        if (cancelled) return;

        if (response.ok) {
          dispatch({ type: "redeem-success", meetingId: response.meetingId });
        } else {
          // The API's own message, verbatim — never a reason code or
          // anything this screen adds on top (§4.2 step 7 / §4.5 step 4).
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
  }, [state.phase, code]);

  // ---------------------------------------------------------------------
  // The join: a successful redeem plus a fix that eventually arrived.
  //
  // Runs only once the connection already exists, so nothing it does can
  // affect whether the tap succeeded. `cancelled` covers unmount and a
  // retry; the whole body is wrapped so that no rejection from either call
  // can reach React as an unhandled promise on a screen showing success.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (state.phase !== "success") return;
    const pending = locationRef.current;
    if (pending === null) return;

    const meetingId = state.meetingId;
    let cancelled = false;

    void (async () => {
      try {
        const location = await pending;
        if (cancelled || !location.ok) return;
        await attachNfcLocation({ meetingId, location: location.fix });
      } catch {
        // Swallowed on purpose — see the header. The connection is made; a
        // missing place name is not something to tell anybody about.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state]);

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      {state.phase === "verifying" && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-muted-foreground">Confirming your tap&hellip;</p>
        </div>
      )}

      {state.phase === "success" && (
        <div className="flex flex-col items-center gap-4">
          <h2 className="text-xl font-semibold">You&rsquo;re connected.</h2>
        </div>
      )}

      {(state.phase === "failure" || state.phase === "error") && (
        <ErrorPanel
          message={state.message}
          onRetry={() => dispatch({ type: "retry" })}
          code={code}
        />
      )}
    </div>
  );
}

/** Turns anything `redeemNfc` can throw into user-facing text. */
function apiErrorMessage(error: unknown): string {
  return error instanceof ConnectApiError
    ? error.message
    : "Couldn't reach SmartCard. Check your connection and try again.";
}

/**
 * A refused tap, plus the way out of the most common reason for one.
 *
 * WHY "SET UP THIS CARD" IS OFFERED ON EVERY FAILURE RATHER THAN ONLY ON
 * `card_unassigned`
 *
 * Because this screen is not allowed to know which failure it got. The redeem
 * API returns `userFacingMessage()`'s text and no reason code, and
 * `user-messages.ts` fuses `card_not_found`, `card_unassigned` and
 * `card_revoked` into one sentence on purpose — distinguishing them "would turn
 * the endpoint into an oracle for which 48-bit card codes exist". Branching
 * this affordance on the real reason would require the API to leak it, which
 * would undo that in order to hide a button.
 *
 * Offering it unconditionally costs nothing, because the button is not the
 * check: `claim_unassigned_card` re-resolves the code and refuses anything that
 * is not `unassigned` (20260821120000). Pressing it on a revoked or unknown
 * card spends a little of the caller's own claim budget and returns the same
 * one refusal. The copy is written as a conditional — "if this is a new card" —
 * so it never asserts that this particular card is claimable, which is exactly
 * what this screen cannot know.
 */
function ErrorPanel({
  message,
  onRetry,
  code,
}: {
  message: string;
  onRetry: () => void;
  code: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-destructive">{message}</p>
      <Button onClick={onRetry}>Try again</Button>

      <div className="flex flex-col items-center gap-2 pt-2">
        <p className="max-w-[34ch] text-[13px] leading-[19px] text-muted-foreground text-pretty">
          If this is a new card that nobody has set up yet, you can make it yours.
        </p>
        <ClaimCardButton code={code} />
      </div>
    </div>
  );
}
