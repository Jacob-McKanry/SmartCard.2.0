import { describe, expect, it, vi } from "vitest";

import { completeOnboarding, deleteOwnAccount, getOnboardingStatus, skipOnboarding } from "../index";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("getOnboardingStatus", () => {
  it("returns the completed flag, not the whole envelope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, completed: true }));

    await expect(getOnboardingStatus({ fetchImpl })).resolves.toBe(true);
  });

  it("distinguishes false from true rather than treating any truthy body as done", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, completed: false }));

    await expect(getOnboardingStatus({ fetchImpl })).resolves.toBe(false);
  });
});

describe("completeOnboarding", () => {
  it("defaults to an empty body when nothing is passed, matching an empty web form", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await completeOnboarding(undefined, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/onboarding/complete");
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("sends only the fields onboarding is allowed to touch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await completeOnboarding({ first_name: "Ada", bio: "Hi" }, { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ first_name: "Ada", bio: "Hi" });
  });

  it("rejects a field onboarding does not accept, such as username, before ever calling fetch", async () => {
    const fetchImpl = vi.fn();

    // @ts-expect-error -- username is deliberately not part of this request shape
    await expect(completeOnboarding({ username: "ada" }, { fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("skipOnboarding", () => {
  it("posts with no body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await skipOnboarding({ fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/onboarding/skip");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });
});

describe("deleteOwnAccount", () => {
  it("issues a DELETE against /api/v1/account", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await deleteOwnAccount({ fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/account");
    expect(init.method).toBe("DELETE");
  });
});
