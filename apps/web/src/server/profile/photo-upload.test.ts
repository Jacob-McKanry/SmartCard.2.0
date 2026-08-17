import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { InvalidPhotoError, removeOwnProfilePhoto, replaceOwnProfilePhoto } from "./photo-upload";

/**
 * DRIVES THE ACTUAL UPLOAD PATH WITH REAL IMAGE BYTES.
 *
 * Added alongside the 2026-08-17 change that widened `profile-photos` from
 * webp-only to webp/jpeg/png/gif (20260817120000_profile_photos_allow_common_
 * image_types.sql). This file had no test at all before that change — the
 * only thing that had ever exercised `assertUploadable`/`replaceOwnProfilePhoto`
 * was a person clicking through the UI. Given the previous restriction was
 * `file.type !== "image/webp"`, the change most worth pinning down with a real
 * test is exactly the one that regressed silently before: a genuine, real
 * JPEG (or PNG, WEBP, GIF) file reaching this function and being accepted.
 *
 * The four fixtures below are real encoded images — generated once with
 * `sharp` and confirmed with `file(1)`'s magic-byte detection ("JPEG image
 * data, baseline...", "PNG image data...", "RIFF... Web/P image...", "GIF
 * image data, version 89a...") — not `File` objects with a hand-set `.type`
 * string and arbitrary bytes behind them. `assertUploadable` only ever
 * inspects `file.type`, so a fake `.type` would pass either way; using real
 * bytes is what makes this a meaningful smoke test of "does an actual photo
 * of this format go through", not just an assertion about a string compare.
 */

// prettier-ignore
const REAL_IMAGE_FIXTURES = {
  "image/jpeg": {
    extension: "jpg",
    base64:
      "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJwA/BH/2Q==",
  },
  "image/png": {
    extension: "png",
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWOQqziBFTEMLQkABkZXgQ4un2QAAAAASUVORK5CYII=",
  },
  "image/webp": {
    extension: "webp",
    base64: "UklGRjoAAABXRUJQVlA4IC4AAAAQAgCdASoIAAgAAUAmJaACdLoB+AH4AAPIAP7tTd/9QWCsy/ew/+jBcBwPeEAA",
  },
  "image/gif": {
    extension: "gif",
    base64: "R0lGODlhCAAIAIAAAExpcR54yCH5BAUAAAAALAAAAAAIAAgAAAIHjI+py+1dAAA7",
  },
} as const;

function realImageFile(mimeType: keyof typeof REAL_IMAGE_FIXTURES, name = "photo"): File {
  const { base64 } = REAL_IMAGE_FIXTURES[mimeType];
  const bytes = Buffer.from(base64, "base64");
  return new File([bytes], name, { type: mimeType });
}

const USER_ID = "11111111-1111-1111-1111-111111111111";
const BUCKET = "profile-photos";

interface Call {
  upload?: { path: string; contentType?: string; upsert?: boolean };
  remove?: string[];
  update?: { photo_path: string | null };
}

/**
 * The smallest fake that behaves like the calls `photo-upload.ts` makes:
 * `.from("users").select(...).eq(...).single()`,
 * `.from("users").update(...).eq(...)`, and
 * `.storage.from(BUCKET).upload/remove(...)`. Records every storage/update
 * call in order so a test can assert not just "it didn't throw" but exactly
 * what path, content type and upsert flag were sent.
 */
function fakeClient(options: {
  existingPhotoPath?: string | null;
  failUpload?: boolean;
  failUpdate?: boolean;
} = {}): { client: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  let photoPath: string | null = options.existingPhotoPath ?? null;

  const usersTable = {
    select: () => usersTable,
    update: (patch: { photo_path: string | null }) => {
      calls.push({ update: patch });
      if (!options.failUpdate) photoPath = patch.photo_path;
      return usersTable;
    },
    eq: () => usersTable,
    single: () =>
      Promise.resolve({ data: { photo_path: photoPath }, error: null as { message: string } | null }),
    then(onFulfilled: (value: { error: { message: string } | null }) => unknown) {
      // Only the `.update(...).eq(...)` chain resolves through `then` (it is
      // never `.single()`-terminated) — mirrors supabase-js's own shape.
      return Promise.resolve({
        error: options.failUpdate ? { message: "permission denied for table users" } : null,
      }).then(onFulfilled);
    },
  };

  const storage = {
    from: (bucket: string) => ({
      upload: (path: string, _file: File, opts: { contentType?: string; upsert?: boolean }) => {
        calls.push({ upload: { path, contentType: opts.contentType, upsert: opts.upsert } });
        expect(bucket).toBe(BUCKET);
        return Promise.resolve({
          error: options.failUpload ? { message: "new row violates row-level security policy" } : null,
        });
      },
      remove: (paths: string[]) => {
        calls.push({ remove: paths });
        return Promise.resolve({ error: null });
      },
    }),
  };

  return {
    client: {
      from: () => usersTable,
      storage,
    } as unknown as SupabaseClient,
    calls,
  };
}

describe("replaceOwnProfilePhoto — real image bytes, one per allowed format", () => {
  it.each(Object.entries(REAL_IMAGE_FIXTURES))(
    "accepts a genuine %s file and stores it with the matching extension",
    async (mimeType, { extension }) => {
      const { client, calls } = fakeClient();
      const file = realImageFile(mimeType as keyof typeof REAL_IMAGE_FIXTURES);

      const newPath = await replaceOwnProfilePhoto(client, USER_ID, file);

      expect(newPath).toMatch(new RegExp(`^${USER_ID}/[0-9a-f-]+\\.${extension}$`));
      const upload = calls.find((c) => c.upload)?.upload;
      expect(upload?.path).toBe(newPath);
      // The bucket is told the upload's real content type, not a hardcoded
      // "image/webp" — the bug this whole change fixes.
      expect(upload?.contentType).toBe(mimeType);
      expect(upload?.upsert).toBe(false);

      const update = calls.find((c) => c.update)?.update;
      expect(update?.photo_path).toBe(newPath);
    },
  );

  it("derives the extension from the validated MIME type, never from the client's filename", async () => {
    // A file claiming to be a JPEG by content type but named like something
    // else entirely — proves the stored extension tracks `file.type` through
    // the allowlist map, not `file.name`, which a client fully controls.
    const { client, calls } = fakeClient();
    const file = realImageFile("image/jpeg", "not-a-real-name.exe");

    const newPath = await replaceOwnProfilePhoto(client, USER_ID, file);

    expect(newPath.endsWith(".jpg")).toBe(true);
    expect(calls.find((c) => c.upload)?.upload?.path).toBe(newPath);
  });

  it("still rejects a format outside the four-value allowlist", async () => {
    const { client } = fakeClient();
    // Real JPEG bytes, but claiming a type `ALLOWED_MIME_TYPES` deliberately
    // never includes — `image/svg+xml` is excluded on purpose (see that
    // migration's header: an SVG can carry a <script>, and these objects are
    // later re-read by both a browser and the server's own vCard embedder).
    // `assertUploadable` only ever looks at `file.type`, so this proves the
    // check, not the fixture's real bytes.
    const bytes = Buffer.from(REAL_IMAGE_FIXTURES["image/jpeg"].base64, "base64");
    const disguised = new File([bytes], "photo.svg", { type: "image/svg+xml" });

    await expect(replaceOwnProfilePhoto(client, USER_ID, disguised)).rejects.toThrow(
      InvalidPhotoError,
    );
    await expect(replaceOwnProfilePhoto(client, USER_ID, disguised)).rejects.toThrow(
      /JPEG, PNG, WEBP or GIF/,
    );
  });

  it("still rejects an oversized file", async () => {
    const { client } = fakeClient();
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.jpg", {
      type: "image/jpeg",
    });

    await expect(replaceOwnProfilePhoto(client, USER_ID, oversized)).rejects.toThrow(
      /too large/,
    );
  });

  it("still rejects an empty file", async () => {
    const { client } = fakeClient();
    const empty = new File([], "empty.jpg", { type: "image/jpeg" });

    await expect(replaceOwnProfilePhoto(client, USER_ID, empty)).rejects.toThrow(/empty/);
  });

  it("rolls back the newly uploaded object if the pointer write fails", async () => {
    const { client, calls } = fakeClient({ failUpdate: true });
    const file = realImageFile("image/png");

    await expect(replaceOwnProfilePhoto(client, USER_ID, file)).rejects.toThrow(
      /Failed to save the new photo path/,
    );

    const uploaded = calls.find((c) => c.upload)?.upload?.path;
    expect(calls.find((c) => c.remove)?.remove).toEqual([uploaded]);
  });

  it("removes the previous object once the new one is safely pointed at", async () => {
    const previous = `${USER_ID}/old-photo.webp`;
    const { client, calls } = fakeClient({ existingPhotoPath: previous });
    const file = realImageFile("image/gif");

    await replaceOwnProfilePhoto(client, USER_ID, file);

    const removeCalls = calls.filter((c) => c.remove);
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0]?.remove).toEqual([previous]);
  });
});

describe("removeOwnProfilePhoto", () => {
  it("clears the pointer and removes the stored object regardless of its format", async () => {
    const existing = `${USER_ID}/photo.jpg`;
    const { client, calls } = fakeClient({ existingPhotoPath: existing });

    await removeOwnProfilePhoto(client, USER_ID);

    expect(calls.find((c) => c.update)?.update).toEqual({ photo_path: null });
    expect(calls.find((c) => c.remove)?.remove).toEqual([existing]);
  });

  it("is a no-op when there is no photo to remove", async () => {
    const { client, calls } = fakeClient({ existingPhotoPath: null });

    await removeOwnProfilePhoto(client, USER_ID);

    expect(calls).toHaveLength(0);
  });
});
