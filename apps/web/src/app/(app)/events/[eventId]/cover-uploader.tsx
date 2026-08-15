"use client";

import { useActionState, useRef, useState } from "react";
import { ImageUp } from "lucide-react";

import { removeEventCoverAction, uploadEventCoverAction } from "../actions";
import { initialEventActionState, type EventActionState } from "../action-state";

/**
 * "Cover image" on the host panel of `/events/[eventId]` — the only place in the
 * app that sets `events.cover_image_path`.
 *
 * WHY IT IS HERE AND NOT ON THE CREATE FORM
 *
 * The Storage key is `{event_id}/cover.{ext}` and the policies parse the event id
 * out of it to check the host (20260814051400), so a cover cannot exist before
 * its event does. `server/events/cover-upload.ts` lays out the alternatives that
 * were rejected. The practical consequence for this component: it is only ever
 * rendered for a host, on a page for an event that already exists, and both of
 * those are re-derived server-side on every submit rather than assumed from the
 * fact that this rendered.
 *
 * WHY IT SITS ON THE DARK PANEL
 *
 * `host-tools.tsx` explains the rule: the dark ground is "only you can do this"
 * made visible. Changing an event's cover is host-only, so it goes here — and
 * the styling below is dark-panel styling for that reason, not for contrast.
 *
 * THE CLIENT-SIDE CHECKS ARE FOR THE MESSAGE, NOT FOR SAFETY
 *
 * They mirror the bucket's `allowed_mime_types` and `file_size_limit` so a
 * person who picks a 12MB HEIC gets a sentence instead of a raw Storage error.
 * A request that skips this component entirely still meets the same two limits
 * at the Storage API, plus the host-only INSERT/UPDATE policies, plus the
 * `events` UPDATE policy. See `cover-upload.ts`.
 *
 * NO PREVIEW OF THE PICKED FILE, ON PURPOSE. The hero at the top of this page is
 * the preview, and it updates when the server confirms the write — showing a
 * local `URL.createObjectURL` copy first would show the host their new cover
 * whether or not it saved. §7: render stored state.
 */

/** Mirrors the bucket exactly (20260814051400). UX only — see the header. */
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

export function CoverUploader({ eventId, hasCover }: { eventId: string; hasCover: boolean }) {
  const [uploadState, uploadAction, uploading] = useActionState(
    uploadEventCoverAction.bind(null, eventId),
    initialEventActionState,
  );
  const [removeState, removeAction, removing] = useActionState<EventActionState, FormData>(
    removeEventCoverAction.bind(null, eventId),
    initialEventActionState,
  );
  const [clientError, setClientError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleFileChosen() {
    setClientError(null);
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
      setClientError("Please choose a JPEG, PNG or WEBP image.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (file.size > MAX_BYTES) {
      setClientError("That file is too large — the limit is 5MB.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    formRef.current?.requestSubmit();
  }

  const error = clientError ?? uploadState.error ?? removeState.error;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form ref={formRef} action={uploadAction}>
          <input
            ref={inputRef}
            type="file"
            name="cover"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileChosen}
          />
          <button
            type="button"
            disabled={uploading || removing}
            onClick={() => inputRef.current?.click()}
            className="flex min-h-11 items-center gap-[7px] rounded-full px-[18px] text-[13px] leading-[17px] font-semibold disabled:opacity-60"
            style={{
              border: "1px solid rgba(255,255,255,.22)",
              background: "transparent",
              color: "#fff",
            }}
          >
            <ImageUp size={15} strokeWidth={2.1} aria-hidden />
            {uploading ? "Uploading…" : hasCover ? "Replace cover" : "Add a cover"}
          </button>
        </form>

        {hasCover ? (
          <form action={removeAction}>
            <button
              type="submit"
              disabled={uploading || removing}
              className="min-h-11 rounded-full px-[18px] text-[13px] leading-[17px] font-semibold disabled:opacity-60"
              style={{ background: "transparent", color: "rgba(255,255,255,.62)" }}
            >
              {removing ? "Removing…" : "Remove"}
            </button>
          </form>
        ) : null}
      </div>

      {/*
       * One live region for both forms. A failure is stated in words; nothing on
       * this panel changes to imply the cover did save. §7: the hero above is
       * still whatever the database holds.
       */}
      <p aria-live="polite" className="text-[12px] leading-[17px]" style={{ textWrap: "pretty" }}>
        {error === undefined || error === null ? (
          <span style={{ color: "rgba(255,255,255,.5)" }}>
            JPEG, PNG or WEBP, up to 5MB. Everyone who can see the event sees the cover.
          </span>
        ) : (
          <span style={{ color: "#ffb4b4" }}>{error}</span>
        )}
      </p>
    </div>
  );
}
