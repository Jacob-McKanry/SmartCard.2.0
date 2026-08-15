"use client";

import { useCallback, useState } from "react";

import { ConfirmPanel } from "../connections/lib/confirm-panel";
import { revokeCardConsequences } from "../connections/lib/removal-copy";
import { revokeCardAction } from "./actions";

/**
 * The lost-or-stolen-card kill switch §4.5 names, behind the app's own
 * two-step confirmation (`../connections/lib/confirm-panel.tsx`).
 *
 * WHY THE COPY DOES NOT SAY "THIS IS PERMANENT"
 *
 * The RLS policy behind `revokeCardAction` also permits reversing it
 * (`revoked -> assigned`, an owner un-revoking their own card), but no restore
 * action exists anywhere in this app — that is a deliberate scope cut, not a
 * gap being papered over. `docs/design/DESIGN.md` §7's "never invent a
 * capability" cuts both ways: claiming the database forbids a reversal it
 * actually allows is as inaccurate as offering an undo button that does not
 * exist. `revokeCardConsequences` therefore says what is true — the card stops
 * working, it leaves this list, and the app ships no way back.
 */
export function RevokeCard({ cardId, cardCode }: { cardId: string; cardCode: string }) {
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
        Revoke
      </button>

      <ConfirmPanel
        open={confirming}
        onCancel={cancel}
        title={`Revoke card ${cardCode}?`}
        confirmLabel="Yes, revoke card"
        consequences={revokeCardConsequences(cardCode)}
        action={revokeCardAction.bind(null, cardId)}
      />
    </>
  );
}
