"use client";

import { useCallback, useState } from "react";

import { ConfirmPanel } from "../connections/lib/confirm-panel";
import { deleteAccountConsequences } from "../connections/lib/removal-copy";
import { deleteAccountAction } from "./actions";

/**
 * "Delete your account", behind the app's one destructive-confirmation surface
 * (`../connections/lib/confirm-panel.tsx`) — the third caller, after removing a
 * connection and revoking a card.
 *
 * WHY THIS ROW EXISTS NOW WHEN THE SETTINGS SCREEN DELIBERATELY LEFT IT OUT
 *
 * That screen's header said, correctly at the time, that `users.status` had a
 * `'deleted'` value and nothing implemented it, and that "a row that opens a
 * confirm and then cannot delete anything is worse than no row". The backend
 * now exists: `public.soft_delete_own_account()` (20260815130300) does the whole
 * thing in one transaction, and `settings-honesty.test.tsx` has been updated in
 * the same change so its ban on this phrase does not silently keep passing for
 * the wrong reason.
 *
 * WHY THE TRIGGER IS A ROW AND NOT A RED BUTTON
 *
 * §2 reserves `--danger` for the destructive act itself. The row that opens the
 * confirmation is not destructive — the panel's confirm button is, and it is the
 * one thing on either surface painted red. A red row in a settings list is also
 * the shape people tap by accident while scrolling.
 *
 * WHAT HAPPENS IF THE DELETE FAILS
 *
 * `deleteAccountAction` throws, which surfaces as an error rather than as a
 * quiet return, and the person stays signed in with an untouched account —
 * `soft_delete_own_account` is a single transaction, so a failure changed
 * nothing. That is the same posture `revokeCardAction` takes, and it is the
 * right one here: the alternative, catching and showing "something went wrong"
 * inside a panel that has already closed, is how somebody ends up unsure
 * whether their account still exists.
 */
export function DeleteAccount() {
  const [confirming, setConfirming] = useState(false);
  const cancel = useCallback(() => setConfirming(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex min-h-14 w-full items-center gap-[11px] px-[15px] py-3.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] leading-[18px] font-medium">
            Delete your account
          </span>
          <span
            className="block text-[11.5px] leading-4"
            style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
          >
            Hides you everywhere and revokes your cards. Nothing is erased, and an administrator can
            restore it.
          </span>
        </span>
      </button>

      <ConfirmPanel
        open={confirming}
        onCancel={cancel}
        title="Delete your SmartCard account?"
        confirmLabel="Yes, delete my account"
        consequences={deleteAccountConsequences()}
        action={deleteAccountAction}
      />
    </>
  );
}
