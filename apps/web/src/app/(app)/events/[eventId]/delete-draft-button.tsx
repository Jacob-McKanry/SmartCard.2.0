"use client";

import { useCallback, useState } from "react";

import { ConfirmPanel } from "../../connections/lib/confirm-panel";
import { deleteDraftConsequences } from "../../connections/lib/removal-copy";
import { deleteDraftEventAction } from "../actions";

/**
 * "Delete draft" — a real delete, offered only where `isDraft` is true (see
 * the page's own header on why that also means "only the host can be looking
 * at this"). See `deleteDraftEventAction`'s header for why it redirects
 * rather than revalidating: the row is gone, so there is no page left here to
 * come back to.
 */
export function DeleteDraftButton({ eventId }: { eventId: string }) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useCallback(() => setConfirming(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex min-h-11 shrink-0 items-center rounded-full px-[16px] text-[12.5px] leading-[17px] font-semibold"
        style={{ border: "1px solid rgba(13,18,32,.14)", color: "var(--sc-text-muted)" }}
      >
        Delete draft
      </button>

      <ConfirmPanel
        open={confirming}
        onCancel={cancel}
        title="Delete this draft?"
        confirmLabel="Yes, delete draft"
        consequences={deleteDraftConsequences()}
        action={deleteDraftEventAction.bind(null, eventId)}
      />
    </>
  );
}
