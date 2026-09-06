/**
 * Downscale and recompress a photo in the browser before it is ever
 * uploaded — the same thing every consumer photo app (Instagram included)
 * does, and the fix for the class of bug `photo-upload.ts`'s `MAX_BYTES`
 * header records: a phone camera routinely produces a 3-8MB JPEG, which is
 * both slow to upload and can exceed a platform's own request-body ceiling
 * before this app's code ever sees it. A profile photo is rendered at well
 * under 100px in every screen that shows one today — there is no reason to
 * carry the original's full resolution over the wire at all.
 *
 * WHY THIS RUNS ON THE CLIENT, NOT THE SERVER
 *
 * The problem this solves is the SIZE OF THE UPLOAD ITSELF — by the time a
 * server-side resize could run, the full original has already had to cross
 * the network and clear whatever request-body ceiling exists (Vercel's own
 * platform limit is stricter than anything this app configures — see
 * `photo-upload.ts`'s `MAX_BYTES` header). Shrinking after that point
 * doesn't help; the failure already happened. The browser is also simply a
 * better place to do this: `createImageBitmap` + `<canvas>` are standard,
 * dependency-free Web Platform APIs, so this needs no new package the way a
 * server-side resize (`sharp`, discussed and deliberately deferred in
 * `card-preview-service.ts`'s own header) would.
 *
 * WHY GIF IS EXCLUDED
 *
 * Re-encoding through `<canvas>` always flattens to a single static frame —
 * there is no browser API for animated-GIF-in, animated-GIF-out via canvas.
 * Silently turning someone's animated profile photo into a still image is a
 * worse outcome than leaving a large GIF alone and letting the existing
 * size check refuse it if it's genuinely too big, which is rare: GIF is a
 * small minority of uploads and the ones people pick are usually already
 * small enough.
 *
 * WHY PNG STAYS PNG, NEVER BECOMES JPEG
 *
 * JPEG has no alpha channel. Converting a transparent PNG (a common shape
 * for anything that isn't a straight photograph) to JPEG would silently
 * bake an opaque background over what used to be transparent — a visible
 * regression for the sake of a size win this function does not need to make
 * that trade to get: downscaling dimensions alone, independent of format,
 * is normally most of the size reduction for a phone photo (a 4000×3000
 * original at 1600px on the long edge is already down to about 16% of its
 * original pixel count).
 *
 * EVERY FAILURE DEGRADES TO "UPLOAD THE ORIGINAL FILE", NEVER TO AN ERROR
 *
 * `createImageBitmap`, canvas, and `toBlob` are all broadly supported today,
 * but none of this is the actual security or correctness boundary —
 * `photo-upload.ts`'s own header is explicit that the bucket's
 * `file_size_limit`/`allowed_mime_types` and the Storage RLS policy are.
 * This is purely a courtesy that makes the common case smaller and faster;
 * an old browser, a corrupt file, or a decode failure should fall back to
 * the exact behavior this app had before this file existed — the original
 * file, unmodified — and let those real backstops decide, not throw and
 * turn a working upload flow into a broken one.
 */

/** Long-edge cap. Generous relative to every render size in this app (avatars top out well under 100px) so cropping/zoom headroom is never the limiting factor. */
const MAX_DIMENSION = 1600;

/** `canvas.toBlob`'s quality parameter for lossy formats; ignored (harmlessly) for PNG. */
const LOSSY_QUALITY = 0.85;

/**
 * Formats this will recompress. Deliberately not `photo-upload.ts`'s full
 * `ALLOWED_MIME_TYPES` list — GIF is excluded, see this file's own header.
 * Anything not in this set (including GIF, and anything the browser's file
 * picker let through that isn't actually an image) passes through
 * unmodified; the caller's own type/size validation still applies to it.
 */
const COMPRESSIBLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * The scaled-down dimensions for an image, or its own dimensions unchanged
 * if it's already within `maxDimension` on both axes — this never upscales.
 * Pulled out as its own pure function so the one piece of real logic here
 * (the scaling math) is unit-testable without a browser.
 */
export function targetDimensions(
  width: number,
  height: number,
  maxDimension: number = MAX_DIMENSION,
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }
  const scale = maxDimension / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Swaps a filename's extension — cosmetic only; nothing downstream reads it (`photo-upload.ts` derives its own extension from the validated MIME type, never from `file.name`). */
function withExtension(name: string, extension: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base === "" ? "photo" : base}.${extension}`;
}

/**
 * Compresses `file` for upload, or returns it unchanged if compression does
 * not apply or does not help. Never throws.
 *
 * @returns A new, smaller `File` of the same MIME type, or the original
 *   `file` — untouched — when: the type isn't one this compresses (GIF or
 *   anything unrecognized), the image is already within `MAX_DIMENSION`
 *   AND recompressing it would not shrink it further, or anything about the
 *   decode/encode step failed. The caller's existing type/size checks run
 *   on whatever this returns either way.
 */
export async function compressImageForUpload(file: File): Promise<File> {
  const mimeType = file.type.toLowerCase();
  if (!COMPRESSIBLE_TYPES.has(mimeType)) {
    return file;
  }

  try {
    // `imageOrientation: "from-image"` applies the file's own EXIF rotation
    // during decode — without it, a canvas-drawn phone photo commonly comes
    // out sideways, since (unlike an `<img>` tag) canvas historically has
    // not respected EXIF orientation on its own.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = targetDimensions(bitmap.width, bitmap.height);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) {
      bitmap.close();
      return file;
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, mimeType, LOSSY_QUALITY);
    });

    // Never make the upload worse: an already-small, already-optimized image
    // can occasionally come back larger after a fresh re-encode. Keep
    // whichever file is actually smaller.
    if (blob === null || blob.size >= file.size) {
      return file;
    }

    const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    return new File([blob], withExtension(file.name, extension), { type: mimeType });
  } catch {
    return file;
  }
}
