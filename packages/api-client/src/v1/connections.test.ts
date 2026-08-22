import { describe, expect, it, vi } from "vitest";

import {
  ApiV1Error,
  getConnection,
  listConnections,
  removeConnection,
  updateMeetingSharing,
  updateParticipantFlags,
} from "../index";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const OTHER_USER = {
  id: "11111111-1111-4111-8111-111111111111",
  first_name: "Sam",
  last_name: "Rivera",
  username: null,
  photo_path: null,
};

const CONNECTION_LIST_ITEM = {
  connectionId: "22222222-2222-4222-8222-222222222222",
  otherUser: OTHER_USER,
  occurredAt: "2026-08-20T18:00:00.000Z",
  verificationMethod: "nfc_card",
};

describe("listConnections", () => {
  it("returns the parsed list", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, connections: [CONNECTION_LIST_ITEM] }));

    await expect(listConnections({ fetchImpl })).resolves.toEqual([CONNECTION_LIST_ITEM]);
  });
});

describe("getConnection", () => {
  const DETAIL = {
    ok: true,
    connection: {
      id: "22222222-2222-4222-8222-222222222222",
      user_a_id: "33333333-3333-4333-8333-333333333333",
      user_b_id: OTHER_USER.id,
      origin_meeting_id: "44444444-4444-4444-8444-444444444444",
      status: "active",
      created_at: "2026-08-20T18:00:00.000Z",
    },
    meeting: {
      id: "44444444-4444-4444-8444-444444444444",
      occurred_at: "2026-08-20T18:00:00.000Z",
      verification_method: "nfc_card",
      verification_session_id: "55555555-5555-4555-8555-555555555555",
      event_id: null,
      is_private: false,
      location_visibility: "participants_only",
      created_at: "2026-08-20T18:00:00.000Z",
    },
    viewerParticipant: {
      meeting_id: "44444444-4444-4444-8444-444444444444",
      user_id: "33333333-3333-4333-8333-333333333333",
      location_share_consent: false,
      marked_private: false,
    },
    otherParticipant: {
      meeting_id: "44444444-4444-4444-8444-444444444444",
      user_id: OTHER_USER.id,
      location_share_consent: false,
      marked_private: false,
    },
    location: null,
    otherUser: OTHER_USER,
    photoUrl: null,
  };

  it("returns the full assembly on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, DETAIL));

    const result = await getConnection(DETAIL.connection.id, { fetchImpl });

    expect(result).toEqual(DETAIL);
  });

  it("returns null for a 404, rather than throwing — 'not found' and 'not yours' are the same answer here", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { ok: false, message: "No such connection." }));

    await expect(getConnection("does-not-exist", { fetchImpl })).resolves.toBeNull();
  });

  it("still throws for anything that is NOT a 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { ok: false, message: "You need to be signed in." }));

    await expect(getConnection(DETAIL.connection.id, { fetchImpl })).rejects.toBeInstanceOf(ApiV1Error);
  });
});

describe("removeConnection", () => {
  it("issues a DELETE with no body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await removeConnection(CONNECTION_LIST_ITEM.connectionId, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/connections/${CONNECTION_LIST_ITEM.connectionId}`);
    expect(init.method).toBe("DELETE");
  });
});

describe("mutation wrappers hit the right sub-route", () => {
  it("updateMeetingSharing PATCHes .../sharing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await updateMeetingSharing(CONNECTION_LIST_ITEM.connectionId, { location_visibility: "mutuals" }, { fetchImpl });

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe(`/api/v1/connections/${CONNECTION_LIST_ITEM.connectionId}/sharing`);
  });

  it("updateParticipantFlags PATCHes .../participant-flags", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    await updateParticipantFlags(CONNECTION_LIST_ITEM.connectionId, { location_share_consent: true }, { fetchImpl });

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe(`/api/v1/connections/${CONNECTION_LIST_ITEM.connectionId}/participant-flags`);
  });
});
