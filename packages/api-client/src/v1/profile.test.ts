import { describe, expect, it, vi } from "vitest";

import {
  addSocialLink,
  deleteSocialLink,
  getProfile,
  updateProfile,
  updateSocialLink,
  ApiV1Error,
} from "../index";

/**
 * Same posture as `connect.test.ts`: plain Node, no DOM, `fetchImpl` always a
 * stub. Covers what this file is actually responsible for — turning an HTTP
 * response into a typed value or a thrown `ApiV1Error` — not the routes
 * themselves (that suite lives server-side).
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const PROFILE = {
  id: "11111111-1111-4111-8111-111111111111",
  first_name: "Ada",
  last_name: "Lovelace",
  username: null,
  phone_number: null,
  bio: null,
  company_name: null,
  company_role: null,
  photo_path: null,
  email: "ada@example.com",
  email_opt_in: false,
};

describe("getProfile", () => {
  it("returns the parsed profile and photo URL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true, profile: PROFILE, photoUrl: null }));

    const result = await getProfile({ fetchImpl });

    expect(result).toEqual({ profile: PROFILE, photoUrl: null });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/profile",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("attaches a bearer token when one is supplied, and no Authorization header otherwise", async () => {
    // `mockImplementation`, not `mockResolvedValue` with a shared instance — a
    // `Response`'s body can only be read once, and this test calls
    // `getProfile` (and therefore `.json()`) twice.
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(200, { ok: true, profile: PROFILE, photoUrl: null })));

    await getProfile({ fetchImpl, accessToken: "a-real-token" });
    const withToken = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((withToken.headers as Record<string, string>)["Authorization"]).toBe("Bearer a-real-token");

    fetchImpl.mockClear();
    await getProfile({ fetchImpl });
    const withoutToken = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((withoutToken.headers as Record<string, string>)["Authorization"]).toBeUndefined();
  });

  it("throws ApiV1Error with the server's own message on a refusal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { ok: false, message: "You need to be signed in." }));

    await expect(getProfile({ fetchImpl })).rejects.toMatchObject({
      message: "You need to be signed in.",
      status: 401,
    });
  });

  it("throws ApiV1Error rather than propagating a raw network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network down"));

    await expect(getProfile({ fetchImpl })).rejects.toBeInstanceOf(ApiV1Error);
  });
});

describe("updateProfile", () => {
  it("PATCHes only the provided fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await updateProfile({ bio: "Hi there" }, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/profile");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ bio: "Hi there" });
  });

  it("rejects a field outside the update grant before ever calling fetch", async () => {
    const fetchImpl = vi.fn();

    // @ts-expect-error -- is_admin is not part of UserProfileUpdate
    await expect(updateProfile({ is_admin: true }, { fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("social links", () => {
  const LINK = {
    id: "22222222-2222-4222-8222-222222222222",
    user_id: PROFILE.id,
    platform: "instagram",
    url: "https://instagram.com/ada",
    display_order: 0,
    created_at: "2026-08-22T00:00:00.000Z",
    updated_at: "2026-08-22T00:00:00.000Z",
  };

  it("addSocialLink posts and returns the created link", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { ok: true, link: LINK }));

    const result = await addSocialLink(
      { platform: "instagram", url: "https://instagram.com/ada", display_order: 0 },
      { fetchImpl },
    );

    expect(result).toEqual(LINK);
  });

  it("updateSocialLink PATCHes the specific link id in the URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await updateSocialLink(LINK.id, { display_order: 2 }, { fetchImpl });

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe(`/api/v1/profile/social-links/${LINK.id}`);
  });

  it("deleteSocialLink issues a DELETE with no body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await deleteSocialLink(LINK.id, { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });
});
