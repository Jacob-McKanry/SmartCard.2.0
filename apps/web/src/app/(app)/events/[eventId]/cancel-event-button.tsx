"use client";

import { useCallback, useState } from "react";

import { ConfirmPanel } from "../../connections/lib/confirm-panel";
import { cancelEventConsequences } from "../../connections/lib/removal-copy";
import { cancelEventAction } from "../actions";

/**
 * "Cancel event" — the host-facing counterpart to the account-deletion
 * cancellation, behind the app's one destructive-confirmation surface. See
 * `cancelEventAction`'s own header for why this bypasses `useActionState`
 * entirely, matching `RevokeCard`/`DeleteAccount` rather than the rest of
 * this event page's actions.
 *
 * WHY THE COPY SAYS THIS IS PERMANENT, UNLIKE `deleteAccountConsequences`
 *
 * That one is careful NOT to claim permanence, because
 * `restore_deleted_user` genuinely can bring a deletion-cancelled event
 * back. Nothing here reverses `cancelled_reason = 'host_cancelled'` — there
 * is no un-cancel RPC for it — so `cancelEventConsequences` says so, and
 * saying otherwise would be the exact inaccuracy §7 forbids in the other
 * direction.
 */
export function CancelEventButton({
  eventId,
  going,
  pendingOrWaitlisted,
}: {
  eventId: string;
  going: number;
  pendingOrWaitlisted: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useCallback(() => setConfirming(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex min-h-11 items-center rounded-full px-[18px] text-[13px] leading-[17px] font-semibold"
        style={{ border: "1px solid rgba(255,255,255,.22)", color: "rgba(255,255,255,.85)" }}
      >
        Cancel event
      </button>

      <ConfirmPanel
        open={confirming}
        onCancel={cancel}
        title="Cancel this event?"
        confirmLabel="Yes, cancel event"
        consequences={cancelEventConsequences({ going, pendingOrWaitlisted })}
        action={cancelEventAction.bind(null, eventId)}
      />
    </>
  );
}
