import { describe, expect, it, vi } from "vitest";

import { getWakeLock, releaseWakeLock, requestWakeLock, type WakeLockLike } from "./wake-lock";

describe("getWakeLock", () => {
  it("returns null when navigator is undefined", () => {
    expect(getWakeLock(undefined)).toBeNull();
  });

  it("returns null when navigator has no wakeLock property", () => {
    expect(getWakeLock({} as Navigator)).toBeNull();
  });

  it("returns the wakeLock object when present", () => {
    const wakeLock: WakeLockLike = { request: vi.fn() };
    expect(getWakeLock({ wakeLock } as unknown as Navigator)).toBe(wakeLock);
  });
});

describe("requestWakeLock", () => {
  it("resolves null without calling anything when there is no wakeLock API", async () => {
    await expect(requestWakeLock(null)).resolves.toBeNull();
  });

  it("resolves the sentinel on a successful request", async () => {
    const sentinel = { release: vi.fn() };
    const wakeLock: WakeLockLike = { request: vi.fn().mockResolvedValue(sentinel) };
    await expect(requestWakeLock(wakeLock)).resolves.toBe(sentinel);
  });

  it("resolves null, never rejects, when the request itself throws", async () => {
    const wakeLock: WakeLockLike = {
      request: vi.fn().mockRejectedValue(new Error("NotAllowedError")),
    };
    await expect(requestWakeLock(wakeLock)).resolves.toBeNull();
  });
});

describe("releaseWakeLock", () => {
  it("is a no-op when there is no sentinel", async () => {
    await expect(releaseWakeLock(null)).resolves.toBeUndefined();
  });

  it("calls release on the sentinel", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    await releaseWakeLock({ release });
    expect(release).toHaveBeenCalledOnce();
  });

  it("never rejects even when release() throws", async () => {
    const release = vi.fn().mockRejectedValue(new Error("already released"));
    await expect(releaseWakeLock({ release })).resolves.toBeUndefined();
  });
});
