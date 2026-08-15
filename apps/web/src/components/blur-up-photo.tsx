"use client";

import { useState } from "react";

/**
 * A photo that blurs up as it arrives, per `docs/design/DESIGN.md` §2:
 * "Photos **blur up** from `blur(14px)` rather than showing a spinner, because
 * the URL is a short-lived signed link."
 *
 * WHY THIS IS LOAD-DRIVEN AND NOT A FIXED-DURATION KEYFRAME
 *
 * The prototype animates the `sc-blurup` keyframe over a flat one second,
 * because in a design artifact there is no real image and nothing to wait for.
 * Here the source is `signedProfilePhotoUrl` — a freshly minted signed URL into
 * a private Storage bucket, fetched over the network. A one-second keyframe
 * would resolve to a sharp *empty* box whenever the request took longer than
 * that, which is the spinnerless equivalent of lying about being finished. The
 * blur clears on `onLoad` instead, so the animation actually tracks the thing it
 * is supposed to be reporting on.
 *
 * WHY A BARE `<img>` AND NOT `next/image`
 *
 * These URLs are one-hour bearer credentials for objects in a *private* bucket
 * (see `server/profile/photo-url.ts`). Passing them through the Next image
 * optimizer would deposit resized copies of private profile photos in a public,
 * unauthenticated cache path that outlives the signature — reopening exactly the
 * "no publicly fetchable profile asset" hole the private bucket exists to close.
 * Marking them `unoptimized` would get the same bytes with more machinery. The
 * lint rule that prefers `next/image` is about layout shift and bandwidth, and
 * is disabled below with that trade recorded rather than silently suppressed.
 *
 * A failed load (expired signature, deleted object, offline) falls back to
 * whatever the parent renders behind this element — the initials medallion or
 * the avatar fallback — by removing itself. "No photo" is a normal state in this
 * product, not an error worth its own styling.
 */
export function BlurUpPhoto({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");

  if (status === "failed") {
    return null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the header: signed, short-lived URLs into a private bucket must not be cached by the image optimizer.
    <img
      src={src}
      alt={alt}
      className={className ?? "size-full object-cover"}
      onLoad={() => setStatus("loaded")}
      onError={() => setStatus("failed")}
      style={{
        filter: status === "loaded" ? "blur(0)" : "blur(14px)",
        opacity: status === "loaded" ? 1 : 0.4,
        transform: status === "loaded" ? "scale(1)" : "scale(1.04)",
        transition:
          "filter .6s var(--sc-ease-glide), opacity .6s var(--sc-ease-glide), transform .6s var(--sc-ease-glide)",
      }}
    />
  );
}
