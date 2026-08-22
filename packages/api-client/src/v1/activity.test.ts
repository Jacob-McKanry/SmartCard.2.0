import { describe, expect, it, vi } from "vitest";

import { ApiV1Error, claimCard, getActivity, revokeCard } from "../index";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const TAP = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  tapper: { id: "22222222-2222-4222-8222-222222222222", first_name: "Ada", last_name: "L", username: "ada", photo_path: null },
  consumedAt: "2026-08-01T00:00:00.000Z",
  connectionId: "33333333-3333-4333-8333-333333333333",
};

const PREVIEW = { id: 1, source: "card_code" as const, surface: "preview" as const, viewedAt: "2026-08-01T00:00:00.000Z" };

const CARD = { id: "44444444-4444-4444-8444-444444444444", card_code: "abc123def456" };

describe("getActivity", () => {
  it("returns the three lists together", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true, taps: [TAP], previews: [PREVIEW], cards: [CARD] }));

    await expect(getActivity({ fetchImpl })).resolves.toEqual({ taps: [TAP], previews: [PREVIEW], cards: [CARD] });
  });

  it("drops the envelope's ok field rather than leaking it into the returned shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, taps: [], previews: [], cards: [] }));

    const result = await getActivity({ fetchImpl });

    expect(result).not.toHaveProperty("ok");
  });
});

describe("claimCard", () => {
  it("rejects a malformed code before ever calling fetch", async () => {
    const fetchImpl = vi.fn();

    await expect(claimCard("not a code", { fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts a well-formed code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await claimCard("abc123def456", { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/cards/claim");
    expect(JSON.parse(init.body as string)).toEqual({ code: "abc123def456" });
  });

  it("surfaces an indistinguishable refusal as a thrown ApiV1Error, not a reason to branch on", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(422, { ok: false, message: "This card couldn't be claimed." }));

    await expect(claimCard("abc123def456", { fetchImpl })).rejects.toBeInstanceOf(ApiV1Error);
  });
});

describe("revokeCard", () => {
  it("posts to the card's own revoke route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await revokeCard(CARD.id, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/cards/${CARD.id}/revoke`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });
});
