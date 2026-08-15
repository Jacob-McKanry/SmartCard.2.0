"use client";

import { useCallback, useState } from "react";

import { ConfirmPanel } from "../lib/confirm-panel";
import { removalConsequences } from "../lib/removal-copy";
import { removeConnectionAction } from "./actions";

/**
 * The meeting record's destructive control: a trigger, then the app's own
 * glass confirmation (`../lib/confirm-panel.tsx`), then the one-way write.
 *
 * The copy here is the one place this feature has to be completely honest
 * about §3.6's one-way RLS transition: there is no "undo" button to build,
 * because no such action exists at any layer below this one. Framing this as
 * anything softer than permanent would be describing a capability the app
 * doesn't have.
 *
 * WHAT CHANGED IN THE DESIGN PASS, AND WHY IT IS NOT JUST STYLING
 *
 * The confirmation used to be an inline red-bordered block containing a
 * single run-on sentence. `docs/design/DESIGN.md` §7 requires the second step
 * to name the consequences **individually**, so they are now a list of four
 * specific outcomes. Two of them were not stated at all before — that the
 * other person loses access to your profile, and that the meeting record
 * stays as your history — and both are things a person would reasonably want
 * to know *before* pressing the button rather than discover afterwards.
 */
export function RemoveConnection({
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
        className="min-h-11 flex-1 rounded-[16px] px-3 py-3 text-[13px] leading-[17px] font-semibold"
        style={{
          border: "1px solid rgba(180,35,24,.4)",
          background: "rgba(180,35,24,.05)",
          color: "var(--sc-danger)",
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
        action={removeConnectionAction.bind(null, connectionId)}
      />
    </>
  );
}
