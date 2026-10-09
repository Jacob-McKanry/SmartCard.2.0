"use client";

import { useState } from "react";

import { ConfirmPanel } from "@/app/(app)/connections/lib/confirm-panel";

import { blockUserAction } from "./safety-actions";

/**
 * The shared "Block" action (owner decision 4,
 * `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`). Takes
 * only `targetUserId` and nothing app-specific, so a later phase can drop it
 * onto a real page (profile, connections, roster) with no rework — the same
 * shape `remove-connection.tsx` already uses for a destructive, one-way action.
 *
 * Reuses `ConfirmPanel` — the app's one destructive-confirmation surface —
 * rather than inventing a second one. Blocking is one-way in the same sense
 * that panel already assumes: `unblock_user` exists, but it does not restore
 * the connection `block_user` removed, so the two consequences named here are
 * both real, not decorative.
 */
export function BlockAction({
  targetUserId,
  targetLabel,
}: {
  targetUserId: string;
  /** Used only in the confirmation copy, e.g. a first name. */
  targetLabel: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [blocked, setBlocked] = useState(false);

  if (blocked) {
    return (
      <p className="text-[13px] leading-[18px]" style={{ color: "var(--sc-text-muted)" }}>
        Blocked. You won&apos;t see each other anymore.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-11 rounded-full px-4 text-[13px] leading-[17px] font-semibold"
        style={{ background: "rgba(220,38,38,.08)", color: "#dc2626" }}
      >
        Block
      </button>

      <ConfirmPanel
        open={confirming}
        title={`Block ${targetLabel}?`}
        consequences={[
          "Neither of you will be able to see the other's profile anymore.",
          "If you're connected, the connection is removed.",
          `${targetLabel} is never told that you did this.`,
        ]}
        confirmLabel="Block"
        onCancel={() => setConfirming(false)}
        action={async () => {
          await blockUserAction(targetUserId);
          setConfirming(false);
          setBlocked(true);
        }}
      />
    </>
  );
}
