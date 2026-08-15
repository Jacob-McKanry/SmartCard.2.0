"use client";

import { useCallback, useState } from "react";

import { ConfirmPanel } from "../connections/lib/confirm-panel";
import { removalConsequences } from "../connections/lib/removal-copy";
import { removeConnectionFromActivityAction } from "./actions";

/**
 * The Activity page's own remove-connection control.
 *
 * Still a separate component from the meeting record's `RemoveConnection`,
 * for the reason it always was: the two call different Server Actions,
 * because that one re-renders the record it lives on and this one re-renders
 * the Activity list in place. What is now shared is everything that must not
 * diverge — the confirmation panel itself and the four consequences it names
 * (see `../connections/lib/removal-copy.ts`). One irreversible transition
 * described two different ways is a defect, not a style difference.
 *
 * The trigger uses Activity's own flat button treatment (`docs/design/
 * DESIGN.md` §2: Activity is deliberately plainer than the rest of the app),
 * but it opens the identical glass confirmation — so the *decision* looks the
 * same everywhere in the app that it can be made.
 */
export function RemoveConnectionInline({
  connectionId,
  otherName,
}: {
  connectionId: string;
  otherName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useCallback(() => setConfirming(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-11 shrink-0 rounded-[10px] px-3 py-[7px] text-[12px] leading-4 font-semibold transition-colors duration-200"
        style={{
          border: "1px solid rgba(13,18,32,.12)",
          background: "#fff",
          color: "var(--sc-text-muted)",
        }}
      >
        Remove connection
      </button>

      <ConfirmPanel
        open={confirming}
        onCancel={cancel}
        title={`Remove your connection with ${otherName}?`}
        confirmLabel="Yes, remove connection"
        consequences={removalConsequences(otherName)}
        action={removeConnectionFromActivityAction.bind(null, connectionId)}
      />
    </>
  );
}
