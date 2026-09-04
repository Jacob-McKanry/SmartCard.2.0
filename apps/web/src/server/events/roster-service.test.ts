import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { getAttendeeProfile, listEventRoster } from "./roster-service";

/**
 * The roster service layer, tested for the property its own header claims:
 * `listEventRoster` and `getAttendeeProfile` take OPPOSITE failure postures,
 * mirroring `attended-events-service.test.ts`'s own pair for the identical
 * reason — a decorative list degrades to empty, a single profile open must
 * tell "the network broke" apart from "you can't see this person".
 *
 * What is NOT tested here: that `event_roster`/`event_attendee_profile` only
 * ever admit the right callers to the right rows. That is the RPCs' own job
 * (20260904100000), verified live in a rolled-back transaction against a
 * hidden subject, a non-attendee caller, an unstarted event and a
 * rate-limited caller — see that migration's header.
 */

vi.spyOn(console, "error").mockImplementation(() => undefined);

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";

function fakeRpcClient(answer: { data?: unknown; error?: { message: string } }): SupabaseClient {
  return {
    async rpc() {
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  } as unknown as SupabaseClient;
}

describe("listEventRoster", () => {
  it("returns the roster entries on success", async () => {
    const client = fakeRpcClient({
      data: [
        { user_id: USER_A, first_name: "Ada", last_name: "One", photo_path: null },
        { user_id: USER_B, first_name: "Bo", last_name: "Two", photo_path: "path/b.webp" },
      ],
    });
    const result = await listEventRoster(client, EVENT_ID);
    expect(result.map((entry) => entry.user_id)).toEqual([USER_A, USER_B]);
  });

  it("returns [] when nobody is visible yet", async () => {
    const client = fakeRpcClient({ data: [] });
    await expect(listEventRoster(client, EVENT_ID)).resolves.toEqual([]);
  });

  it("fails closed to [] on an RPC error, never throwing", async () => {
    const client = fakeRpcClient({ error: { message: "boom" } });
    await expect(listEventRoster(client, EVENT_ID)).resolves.toEqual([]);
  });

  it("fails closed to [] on a malformed response, never trusting it", async () => {
    const client = fakeRpcClient({ data: [{ nonsense: true }] });
    await expect(listEventRoster(client, EVENT_ID)).resolves.toEqual([]);
  });

  it("fails closed to [] on a thrown transport error", async () => {
    const client = {
      async rpc() {
        throw new Error("network down");
      },
    } as unknown as SupabaseClient;
    await expect(listEventRoster(client, EVENT_ID)).resolves.toEqual([]);
  });
});

/**
 * `getAttendeeProfile` — deliberately the OPPOSITE failure posture from
 * `listEventRoster` above. `{available: false}` is a real, expected answer
 * (§3.6's indistinguishable refusal) and becomes `null`; everything else —
 * a transport error, a malformed payload — throws, because a caller opening
 * one person's card needs to tell those apart.
 */
describe("getAttendeeProfile", () => {
  it("returns the mapped fields when the RPC admits the caller", async () => {
    const client = fakeRpcClient({
      data: {
        available: true,
        first_name: "Ada",
        last_name: "One",
        company_name: "Acme",
        company_role: "Engineer",
        bio: "Hello",
        phone_number: "+15551234567",
        email: "ada@example.com",
        photo_path: "path/a.webp",
        social_links: [{ id: "44444444-4444-4444-8444-444444444444", platform: "x", url: "https://example.com/ada" }],
      },
    });
    const result = await getAttendeeProfile(client, EVENT_ID, USER_A, false);
    expect(result).toEqual({
      firstName: "Ada",
      lastName: "One",
      companyName: "Acme",
      companyRole: "Engineer",
      bio: "Hello",
      phoneNumber: "+15551234567",
      email: "ada@example.com",
      photoPath: "path/a.webp",
      socialLinks: [{ id: "44444444-4444-4444-8444-444444444444", platform: "x", url: "https://example.com/ada" }],
    });
  });

  it("returns null for the RPC's own {available: false} refusal — not an error", async () => {
    const client = fakeRpcClient({ data: { available: false } });
    await expect(getAttendeeProfile(client, EVENT_ID, USER_A, false)).resolves.toBeNull();
  });

  it("throws, never returns null, on an RPC error", async () => {
    const client = fakeRpcClient({ error: { message: "boom" } });
    await expect(getAttendeeProfile(client, EVENT_ID, USER_A, false)).rejects.toThrow(
      /Failed to load this person's profile/,
    );
  });

  it("throws on a malformed RPC response", async () => {
    const client = fakeRpcClient({ data: { nonsense: true } });
    await expect(getAttendeeProfile(client, EVENT_ID, USER_A, false)).rejects.toThrow(
      /unexpected shape/,
    );
  });
});
