"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

/**
 * The app's one destructive-confirmation surface — `docs/design/DESIGN.md`
 * §7 ("Destructive = two steps, one way") and the `confirmOpen` block of
 * `SmartCard 2.0.dc.html`.
 *
 * THREE RULES THIS COMPONENT EXISTS TO ENFORCE, NOT MERELY TO DECORATE
 *
 *  1. **Two steps.** The caller renders a trigger; this panel is the second
 *     step. The Server Action is bound to a `<form>` *inside* the panel, so
 *     there is no code path where one tap performs a destructive write.
 *
 *  2. **The consequences are named individually.** `consequences` is a list,
 *     not a paragraph, because §7 asks for each outcome to be stated on its
 *     own — a single run-on sentence is how "and your meeting history stays"
 *     gets skimmed past. Callers pass real, specific sentences; this component
 *     has no default copy to fall back on, deliberately.
 *
 *  3. **The app's own glass, never a system alert.** `window.confirm()` is
 *     dismissible by muscle memory, unstyleable, and cannot show a list. It is
 *     also the browser's voice rather than the product's, which matters when
 *     the thing being said is "this cannot be undone".
 *
 * WHY THERE IS NO "UNDO" AFFORDANCE ANYWHERE IN HERE
 *
 * Both actions that use this panel are one-way at the database layer:
 * `connections.status` has an `active -> removed` grant and no reverse
 * (`20260809211200`), and no restore action for a revoked card exists in this
 * app. §7's "never invent a capability" makes the copy's job to say so — so
 * this component gives callers nowhere to put a "you can change this later"
 * reassurance, because there is no such capability to describe.
 *
 * ACCESSIBILITY (§8): `role="dialog"` + `aria-modal`, labelled by its own
 * title, Escape cancels, and focus lands on **Cancel** rather than on the
 * destructive button — the safe option should be the one a stray Enter hits.
 */
export function ConfirmPanel({
  open,
  title,
  consequences,
  confirmLabel,
  onCancel,
  action,
}: {
  open: boolean;
  title: string;
  /** One sentence per real consequence. See rule 2 in the header. */
  consequences: readonly string[];
  confirmLabel: string;
  onCancel: () => void;
  /** A Server Action, already bound to its target id by the caller. */
  action: () => void | Promise<void>;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const titleId = `confirm-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-[26px]"
      style={{ background: "rgba(13,18,32,.3)", backdropFilter: "blur(4px)" }}
      // A click on the scrim cancels, matching the Escape key. It never
      // confirms — the only way to the destructive write is the labelled
      // button.
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-[360px] flex-col gap-3 rounded-[28px] p-[22px]"
        style={{
          background: "rgba(255,255,255,.9)",
          backdropFilter: "blur(30px) saturate(1.7)",
          WebkitBackdropFilter: "blur(30px) saturate(1.7)",
          border: "1px solid rgba(255,255,255,.9)",
          boxShadow: "0 30px 70px -18px rgba(13,18,32,.4)",
          animation: "sc-spring-in .42s var(--sc-ease-spring) both",
        }}
      >
        <h2
          id={titleId}
          className="text-[17px] leading-[22px] font-semibold tracking-[-0.02em]"
          style={{ textWrap: "pretty" }}
        >
          {title}
        </h2>

        <ul className="flex flex-col gap-2">
          {consequences.map((line) => (
            <li
              key={line}
              className="flex gap-2.5 text-[13px] leading-[19px]"
              style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
            >
              <span
                aria-hidden
                className="mt-[7px] size-[5px] shrink-0 rounded-full"
                style={{ background: "rgba(13,18,32,.22)" }}
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="mt-1 flex flex-col gap-2">
          <form action={action}>
            <ConfirmSubmit label={confirmLabel} />
          </form>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="w-full rounded-full py-[13px] text-[14px] leading-[18px] font-semibold"
            style={{
              border: "1px solid rgba(13,18,32,.12)",
              background: "rgba(255,255,255,.7)",
              color: "var(--sc-text)",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Split out purely so `useFormStatus` can read the enclosing form's pending
 * state — the hook only reports on a form it is rendered *inside*. Disabling
 * while pending is not cosmetic here: a double-submitted removal makes the
 * second call fail loudly (`removeConnection` throws when zero rows match),
 * which would surface as an error on an action that actually succeeded.
 */
function ConfirmSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full py-[14px] text-[14px] leading-[18px] font-semibold text-white disabled:opacity-70"
      style={{ background: "var(--sc-danger)" }}
    >
      {pending ? "Working…" : label}
    </button>
  );
}
