import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { supabaseCardPreviewStore } from "./card-preview-service";

/**
 * A regression pin for the bug found 2026-08-28: `MAX_EMBEDDED_PHOTO_BYTES`
 * used to be 256 KiB, sized against the legacy backfill's largest photo
 * (170,214 bytes). Once JPEG/PNG/GIF uploads were allowed
 * (20260826_profile_photos_allow_common_image_types), real phone-camera
 * uploads landed in the multi-megabyte range and the cap silently dropped
 * `PHOTO` for every one of them — found by reading `storage.objects` on the
 * live project, not assumed. The cap now matches `profile-photos`' own
 * `file_size_limit` (5 MiB, confirmed live), on the reasoning that a photo
 * the upload path already accepted has no principled reason to be silently
 * refused here. This test exists so nobody quietly shrinks the cap back down
 * and reintroduces exactly that bug.
 *
 * `card-preview-service.ts`'s own test file mocks the abstract
 * `CardPreviewStore` interface throughout and never exercises
 * `supabaseCardPreviewStore` — the production wiring — directly. This file
 * is the first test of that function, scoped to the one behaviour that
 * regressed.
 */

const FIVE_MIB = 5 * 1024 * 1024;

function fakeStorageClient(photoBytes: Uint8Array, mimetype: string): SupabaseClient {
  return {
    storage: {
      from: () => ({
        async download() {
          return {
            data: {
              type: mimetype,
              size: photoBytes.byteLength,
              async arrayBuffer() {
                return photoBytes.buffer;
              },
            },
            error: null,
          };
        },
      }),
    },
  } as unknown as SupabaseClient;
}

describe("supabaseCardPreviewStore().loadPhotoBytes — the size cap", () => {
  it("embeds a photo at the bucket's own 5 MiB ceiling", async () => {
    const bytes = new Uint8Array(FIVE_MIB);
    const store = supabaseCardPreviewStore(fakeStorageClient(bytes, "image/jpeg"));

    const result = await store.loadPhotoBytes("someone/photo.jpg");

    expect(result).not.toBeNull();
    expect(result?.vCardType).toBe("JPEG");
  });

  it("still refuses something larger than the bucket could ever hold", async () => {
    const bytes = new Uint8Array(FIVE_MIB + 1);
    const store = supabaseCardPreviewStore(fakeStorageClient(bytes, "image/jpeg"));

    const result = await store.loadPhotoBytes("someone/photo.jpg");

    expect(result).toBeNull();
  });

  it("embeds a real-world phone-camera-sized JPEG that the old 256 KiB cap silently dropped", async () => {
    // The exact class of upload found live in production 2026-08-28: a
    // ~3 MB JPEG, comfortably past the old cap and comfortably under the new
    // one.
    const bytes = new Uint8Array(3_098_426);
    const store = supabaseCardPreviewStore(fakeStorageClient(bytes, "image/jpeg"));

    const result = await store.loadPhotoBytes("someone/photo.jpg");

    expect(result).not.toBeNull();
  });
});
