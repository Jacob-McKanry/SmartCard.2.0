"use client";

import { useActionState } from "react";

import { publishEventAction } from "../actions";
import { initialEventActionState } from "../action-state";
import { PRIMARY_BUTTON } from "../lib/surfaces";

/**
 * The one control on `DraftNotice` — publishing is otherwise unreachable, since
 * `status` is outside the UPDATE column grant on purpose (`publishEventAction`'s
 * own header). This page only ever renders for the host to begin with (a draft
 * is invisible to anyone else via `private.can_see_event`), so there is no
 * separate role check here — the page itself is the gate.
 */
export function PublishDraftButton({ eventId }: { eventId: string }) {
  const [state, formAction, pending] = useActionState(
    publishEventAction.bind(null, eventId),
    initialEventActionState,
  );

  if (state.success === true) {
    // The page's own `revalidatePath` means a refresh shows the live event
    // with no draft banner at all; this stands in for the instant between
    // the action resolving and that refresh landing.
    return (
      <p className="text-[12px] leading-[17px] font-medium" style={{ color: "var(--sc-accent-deep)" }}>
        Published — refresh to see it live.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col items-start gap-1.5">
      <button
        type="submit"
        disabled={pending}
        className="flex min-h-11 items-center rounded-full px-[18px] text-[13px] leading-[17px] font-semibold disabled:opacity-60"
        style={PRIMARY_BUTTON}
      >
        {pending ? "Publishing…" : "Publish event"}
      </button>
      {state.error !== undefined ? (
        <p className="text-[12px] leading-[17px]" style={{ color: "var(--sc-danger)" }} role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
