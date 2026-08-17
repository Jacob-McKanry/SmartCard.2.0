"use client";

import { useActionState, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

import { removePhotoAction, uploadPhotoAction } from "./actions";
import { initialActionState } from "./action-state";

/**
 * Mirrors the bucket's own limits
 * (20260817120000_profile_photos_allow_common_image_types.sql) for UX only —
 * this is not the enforcement. See the header comment in
 * `apps/web/src/server/profile/photo-upload.ts` for what actually enforces
 * type and size: the bucket's `allowed_mime_types`/`file_size_limit` and the
 * Storage RLS policy in `20260813191041_storage_rls_profile_photos.sql`. A
 * client that skips this check entirely and posts straight to the action
 * still hits those same two backstops.
 */
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 5 * 1024 * 1024;

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
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleFileChosen() {
    setClientError(null);
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
      setClientError("Please choose a JPEG, PNG, WEBP or GIF image.");
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

  const error = clientError ?? uploadState.error;

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
              onChange={handleFileChosen}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploadPending}
              onClick={() => inputRef.current?.click()}
            >
              {uploadPending ? "Uploading…" : hasPhoto ? "Replace photo" : "Upload photo"}
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
            "JPEG, PNG, WEBP or GIF, up to 5MB."
          )}
        </p>
      </div>
    </div>
  );
}
