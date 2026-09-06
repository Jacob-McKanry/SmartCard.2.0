"use client";

import { useActionState, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { compressImageForUpload } from "@/components/compress-image";

import { removePhotoAction, uploadPhotoAction } from "./actions";
import { initialActionState } from "./action-state";

/**
 * Mirrors the bucket's own limits
 * (20260817120000_profile_photos_allow_common_image_types.sql,
 * 20260906120000_profile_photos_shrink_size_limit.sql) for UX only —
 * this is not the enforcement. See the header comment in
 * `apps/web/src/server/profile/photo-upload.ts` for what actually enforces
 * type and size: the bucket's `allowed_mime_types`/`file_size_limit` and the
 * Storage RLS policy in `20260813191041_storage_rls_profile_photos.sql`. A
 * client that skips this check entirely and posts straight to the action
 * still hits those same two backstops.
 */
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * A generous pre-compression sanity ceiling — not the real limit, which is
 * `MAX_BYTES` applied AFTER `compressImageForUpload` runs (see below for why
 * the order flipped). This one exists only to refuse decoding something
 * absurd (a mislabelled video, a raw camera file) before it ties up the
 * browser doing so; ordinary phone photos are nowhere near it.
 */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export function PhotoUploader({
  photoUrl,
  initials,
  hasPhoto,
}: {
  photoUrl: string | null;
  initials: string;
  hasPhoto: boolean;
}) {
  const [uploadState, uploadFormAction, uploadPending] = useActionState(
    uploadPhotoAction,
    initialActionState,
  );
  const [clientError, setClientError] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * WHY THE SIZE CHECK RUNS *AFTER* COMPRESSION, NOT BEFORE
   *
   * The old order rejected anything over `MAX_BYTES` outright — which is
   * exactly backwards for the common real case, a large-but-ordinary phone
   * photo that `compressImageForUpload` would happily shrink under the
   * limit. Checking size on the COMPRESSED result instead means the limit
   * only ever turns away something that is still too big after the browser
   * has already tried to shrink it (a GIF, which is never compressed here,
   * or a pathological image that doesn't compress well) — see
   * `compress-image.ts`'s own header for why GIF is excluded.
   *
   * `MAX_SOURCE_BYTES` above is the one check that still runs on the
   * ORIGINAL file, and for an unrelated reason: refusing to even attempt
   * decoding something absurdly large, before compression gets a chance to
   * help.
   */
  async function handleFileChosen() {
    setClientError(null);
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
      setClientError("Please choose a JPEG, PNG, WEBP or GIF image.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setClientError("That file is too large to process.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setCompressing(true);
    const uploadable = await compressImageForUpload(file);
    setCompressing(false);

    if (uploadable.size > MAX_BYTES) {
      setClientError("That file is too large — the limit is 4MB.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    // Swap the compressed file into the native input's own FileList before
    // submitting, via the standard `DataTransfer` trick — `requestSubmit()`
    // reads whatever `<input type="file">` currently holds, and an
    // `HTMLInputElement.files` can only be assigned a `FileList`, not a
    // plain array or a single `File`.
    if (uploadable !== file && inputRef.current) {
      const transfer = new DataTransfer();
      transfer.items.add(uploadable);
      inputRef.current.files = transfer.files;
    }

    formRef.current?.requestSubmit();
  }

  const error = clientError ?? uploadState.error;
  const buttonLabel = compressing
    ? "Preparing…"
    : uploadPending
      ? "Uploading…"
      : hasPhoto
        ? "Replace photo"
        : "Upload photo";

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-20">
        {photoUrl ? <AvatarImage src={photoUrl} alt="Your profile photo" /> : null}
        <AvatarFallback className="text-lg">{initials}</AvatarFallback>
      </Avatar>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <form ref={formRef} action={uploadFormAction}>
            <input
              ref={inputRef}
              type="file"
              name="photo"
              accept={ALLOWED_MIME_TYPES.join(",")}
              className="hidden"
              onChange={() => void handleFileChosen()}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={compressing || uploadPending}
              onClick={() => inputRef.current?.click()}
            >
              {buttonLabel}
            </Button>
          </form>

          {hasPhoto ? (
            <form action={removePhotoAction}>
              <Button type="submit" variant="ghost" size="sm">
                Remove
              </Button>
            </form>
          ) : null}
        </div>

        <p aria-live="polite" className="text-xs text-muted-foreground">
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : (
            "JPEG, PNG, WEBP or GIF. Large photos are resized automatically."
          )}
        </p>
      </div>
    </div>
  );
}
