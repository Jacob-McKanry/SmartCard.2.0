"use client";

import { useEffect, useReducer } from "react";

import { ConnectApiError, redeemNfc } from "@smartcard/api-client";

import { Button } from "@/components/ui/button";

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
 */
export function CardRedeemFlow({ code }: { code: string }) {
  const [state, dispatch] = useReducer(redeemReducer, initialRedeemState);

  useEffect(() => {
    if (state.phase !== "verifying") return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await redeemNfc({ code });
        if (cancelled) return;

        if (response.ok) {
          dispatch({ type: "redeem-success" });
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
