import { describe, expect, it, vi } from "vitest";

import { getFeed } from "../index";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const PARTICIPANT_ITEM = {
  kind: "participant",
  meetingId: "11111111-1111-4111-8111-111111111111",
  connectionId: "22222222-2222-4222-8222-222222222222",
  occurredAt: "2026-08-20T18:00:00.000Z",
  verificationMethod: "nfc_card",
  otherUser: {
    id: "33333333-3333-4333-8333-333333333333",
    first_name: "Sam",
    last_name: "Rivera",
    username: null,
    photo_path: null,
  },
  location: null,
  event: null,
};

describe("getFeed", () => {
  it("returns the parsed feed items", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, items: [PARTICIPANT_ITEM] }));

    const items = await getFeed({ fetchImpl });

    expect(items).toEqual([PARTICIPANT_ITEM]);
  });

  it("rejects a feed item missing its discriminant, rather than trusting the server blindly", async () => {
    const malformed = { ...PARTICIPANT_ITEM, kind: "something_new" };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, items: [malformed] }));

    await expect(getFeed({ fetchImpl })).rejects.toThrow();
  });

  it("returns an empty list rather than throwing when there is nothing in the feed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, items: [] }));

    await expect(getFeed({ fetchImpl })).resolves.toEqual([]);
  });
});
