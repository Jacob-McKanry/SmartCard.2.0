import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` because `vi.mock`'s factory is hoisted above every ordinary
// top-level statement — a plain `const` here is still in its temporal dead
// zone when the factory runs.
const { geocodeMeetingLocation } = vi.hoisted(() => ({ geocodeMeetingLocation: vi.fn() }));
vi.mock("@/server/connect/geocode", () => ({ geocodeMeetingLocation }));

import { attachNfcMeetingLocation } from "./nfc-location-service";

/**
 * The NFC location attach, tested as the three properties THIS LAYER owns.
 *
 * What is deliberately NOT tested here: whether the meeting is the caller's,
 * whether it is an `nfc_card` one, whether it is recent, whether it already
 * has a location. Those are five gates inside
 * `attach_nfc_meeting_location` (20260828160000), re-derived from
 * `private.current_user_id()` on every call, and they were verified against
 * the live database in a rolled-back transaction as real users with real
 * policies in force — ten scenarios including the card's owner being refused,
 * a third party being refused, a `qr_gps` meeting being refused, and a second
 * attach failing to overwrite the first. A Vitest run has no database, and a
 * mock that "checks" one of those gates would only be checking the mock.
 * Same posture `attendee-import.test.ts` states for its own RPC.
 */

const MEETING_ID = "11111111-1111-4111-8111-111111111111";

const LOCATION = {
  latitude: 40.7128,
  longitude: -74.006,
  accuracyM: 12.5,
  capturedAt: "2026-08-28T18:00:00.000Z",
};

function fakeClient(answer: { data?: unknown; error?: { message: string } }): {
  client: SupabaseClient;
  calls: { fn: string; args: unknown }[];
} {
  const calls: { fn: string; args: unknown }[] = [];
  const client = {
    async rpc(fn: string, args?: unknown) {
      calls.push({ fn, args });
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("attachNfcMeetingLocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------
  // 1. What reaches the database
  // -------------------------------------------------------------------

  it("forwards the fix field by field, with capturedAt intact", async () => {
    const { client, calls } = fakeClient({ data: { attached: true } });

    await attachNfcMeetingLocation(client, { meetingId: MEETING_ID, location: LOCATION });

    expect(calls).toEqual([
      {
        fn: "attach_nfc_meeting_location",
        args: {
          p_meeting_id: MEETING_ID,
          p_latitude: 40.7128,
          p_longitude: -74.006,
          p_accuracy_m: 12.5,
          p_captured_at: "2026-08-28T18:00:00.000Z",
        },
      },
    ]);
  });

  it("refuses a malformed request without calling the database at all", async () => {
    const { client, calls } = fakeClient({ data: { attached: true } });

    const result = await attachNfcMeetingLocation(client, { meetingId: "not-a-uuid" });

    expect(result).toEqual({ attached: false });
    expect(calls).toEqual([]);
  });

  it("refuses an unknown extra field rather than forwarding it", async () => {
    // The request schema is `.strict()`. A field this contract does not carry
    // is a client sending something nobody designed for, and on the connect
    // path that is refused rather than ignored.
    const { client, calls } = fakeClient({ data: { attached: true } });

    const result = await attachNfcMeetingLocation(client, {
      meetingId: MEETING_ID,
      location: LOCATION,
      pretendIAmSomeoneElse: "u2",
    });

    expect(result).toEqual({ attached: false });
    expect(calls).toEqual([]);
  });

  // -------------------------------------------------------------------
  // 2. A refusal is an ordinary answer, never an exception
  // -------------------------------------------------------------------

  it("passes a refusal straight through as the ordinary outcome it is", async () => {
    const { client } = fakeClient({ data: { attached: false } });

    await expect(
      attachNfcMeetingLocation(client, { meetingId: MEETING_ID, location: LOCATION }),
    ).resolves.toEqual({ attached: false });
  });

  it("reads an unrecognised response shape as not-attached, never as success", async () => {
    const { client } = fakeClient({ data: { unexpected: "shape" } });

    const result = await attachNfcMeetingLocation(client, {
      meetingId: MEETING_ID,
      location: LOCATION,
    });

    expect(result).toEqual({ attached: false });
  });

  it("throws only on a transport failure — 'we could not ask' is a monitoring problem", async () => {
    const { client } = fakeClient({ error: { message: "connection reset" } });

    await expect(
      attachNfcMeetingLocation(client, { meetingId: MEETING_ID, location: LOCATION }),
    ).rejects.toThrow(/Failed to attach/);
  });

  // -------------------------------------------------------------------
  // 3. Geocoding happens exactly when a row was actually written
  // -------------------------------------------------------------------

  it("geocodes the meeting when — and only when — this call wrote the row", async () => {
    const { client } = fakeClient({ data: { attached: true } });

    await attachNfcMeetingLocation(client, { meetingId: MEETING_ID, location: LOCATION });

    expect(geocodeMeetingLocation).toHaveBeenCalledTimes(1);
    expect(geocodeMeetingLocation).toHaveBeenCalledWith(MEETING_ID, 40.7128, -74.006);
  });

  it("does not geocode a refused attach — no row means no place to name, and a paid request wasted", async () => {
    const { client } = fakeClient({ data: { attached: false } });

    await attachNfcMeetingLocation(client, { meetingId: MEETING_ID, location: LOCATION });

    expect(geocodeMeetingLocation).not.toHaveBeenCalled();
  });

  it("does not geocode a malformed request", async () => {
    const { client } = fakeClient({ data: { attached: true } });

    await attachNfcMeetingLocation(client, { meetingId: "nope" });

    expect(geocodeMeetingLocation).not.toHaveBeenCalled();
  });
});
