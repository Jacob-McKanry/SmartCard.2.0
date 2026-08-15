"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";

/**
 * Signing out — `isSignout` in `docs/design/prototypes/Auth flow.dc.html`.
 *
 * WHY THIS IS NOT `connections/lib/confirm-panel.tsx`
 *
 * That component is the app's *destructive*-confirmation surface, and the
 * prototype's note on this sheet is explicit that reusing it here would be
 * wrong: "Revoking a card and removing a connection are two-step confirms
 * because they're permanent. This isn't — so it gets one tap, and the copy
 * spends its words ruling out the fear that data goes with it. Matching the
 * destructive pattern here would imply a risk that doesn't exist."
 *
 * Three concrete differences follow from that. The confirm button is §5's
 * neutral primary rather than `--danger`. The body says what signing out does
 * *not* touch, where `ConfirmPanel` deliberately has nowhere to put a
 * reassurance. And it is a bottom sheet rather than a centred dialog, because
 * §5 gives sheets to ordinary decisions and the centred panel to the two
 * one-way ones.
 *
 * Focus still lands on Cancel, exactly as it does in `ConfirmPanel`. That is
 * not a claim that this is dangerous; it is that every sheet in this app should
 * put the same kind of control under a stray Enter, and the person can reach
 * the primary with one Tab.
 *
 * WHY THE LINK IS PASSED IN RATHER THAN IMPORTED HERE
 *
 * `LogoutLink` builds its `href` from `process.env.KINDE_AUTH_API_PATH` and
 * `KINDE_AUTH_LOGOUT_ROUTE` at module scope. Neither carries a `NEXT_PUBLIC_`
 * prefix, so inside a browser bundle both resolve to `undefined` and the
 * component falls back to defaults that are correct today and would silently
 * stop being correct the day either is set. Rendering it on the server and
 * passing the element down means the real values are always used — and it keeps
 * the actual sign-out a plain `<a href="/api/auth/logout">`, which works with
 * no JavaScript at all.
 */
export function SignOutSheet({ logoutLink }: { logoutLink: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-4 py-3.5 text-[14px] leading-[18px] font-semibold"
        style={{
          border: "1px solid rgba(13,18,32,.12)",
          background: "rgba(255,255,255,.7)",
          color: "var(--sc-text)",
        }}
      >
        <LogOut size={15} strokeWidth={2} aria-hidden />
        Sign out
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[70] flex flex-col justify-end"
          style={{ background: "rgba(13,18,32,.3)", backdropFilter: "blur(4px)" }}
          // A tap on the scrim cancels, matching Escape. It never confirms.
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-out-title"
            onClick={(event) => event.stopPropagation()}
            className="mx-auto flex w-full max-w-[440px] flex-col gap-3 px-[22px] pt-6 pb-7"
            style={{
              borderRadius: "32px 32px 0 0",
              background: "rgba(255,255,255,.9)",
              backdropFilter: "blur(32px) saturate(1.8)",
              WebkitBackdropFilter: "blur(32px) saturate(1.8)",
              borderTop: "1px solid rgba(255,255,255,.9)",
              boxShadow: "0 -20px 60px rgba(13,18,32,.24)",
              animation: "sc-sheet .44s var(--sc-ease-glide) both",
            }}
          >
            <h2
              id="sign-out-title"
              className="text-[18px] leading-[23px] font-semibold"
              style={{ letterSpacing: "-.02em" }}
            >
              Sign out of SmartCard?
            </h2>
            {/*
             * The copy's whole job is to rule out the fear that data leaves with
             * the session. Every clause is checkable: signing out clears the
             * Kinde session cookie and nothing else — no row in `users`,
             * `connections`, `cards` or `meetings` is touched by
             * `/api/auth/logout` — and the account is found again by
             * `kinde_user_id`, which is the identity behind that same email
             * address (`server/auth/ensure-user.ts`).
             */}
            <p
              className="text-[13px] leading-[19px]"
              style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
            >
              Your connections, cards and meeting records stay exactly as they are — signing out
              only ends this session on this device. Signing back in needs the same email address.
            </p>

            <div className="mt-1 flex flex-col gap-2">
              {logoutLink}
              <button
                ref={cancelRef}
                type="button"
                onClick={close}
                className="min-h-11 w-full rounded-full py-[13px] text-[14px] leading-[18px] font-semibold"
                style={{
                  border: "1px solid rgba(13,18,32,.12)",
                  background: "rgba(255,255,255,.7)",
                  color: "var(--sc-text)",
                }}
              >
                Cancel
              </button>
            </div>

            <p
              className="mt-0.5 font-mono text-[10.5px] leading-[15px]"
              style={{ color: "var(--sc-text-subtle)" }}
            >
              Asks once, not twice — unlike revoking a card, which cannot be undone.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
