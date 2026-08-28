import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { listOwnAttendedEventIds } from "./attended-events-service";

/**
 * C5's read, tested as the property it owns: EVERY FAILURE MODE FAILS CLOSED
 * TO AN EMPTY SET, NEVER A THROW AND NEVER A GUESS.
 *
 * What is NOT tested here: that `own_attended_events()` only ever returns
 * the CALLER's own rows. That is the RPC's own job (20260828150000),
 * verified live in a rolled-back transaction against a second, unrelated
 * claimant and an unclaimed row — see that migration's header.
 */

vi.spyOn(console, "error").mockImplementation(() => undefined);

function fakeClient(answer: { data?: unknown; error?: { message: string } }): SupabaseClient {
  return {
    async rpc() {
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  } as unknown as SupabaseClient;
}

const EVENT_A = "11111111-1111-4111-8111-111111111111";
const EVENT_B = "22222222-2222-4222-8222-222222222222";

describe("listOwnAttendedEventIds", () => {
  it("returns a Set of the claimed event ids", async () => {
    const client = fakeClient({
      data: [
        { event_id: EVENT_A, claimed_at: "2026-08-28T00:00:00Z" },
        { event_id: EVENT_B, claimed_at: "2026-08-20T00:00:00Z" },
      ],
    });
    const result = await listOwnAttendedEventIds(client);
    expect(result).toEqual(new Set([EVENT_A, EVENT_B]));
  });

  it("returns an empty Set when the caller has claimed nothing", async () => {
    const client = fakeClient({ data: [] });
    const result = await listOwnAttendedEventIds(client);
    expect(result.size).toBe(0);
  });

  it("fails closed to an empty Set on an RPC error, never throwing", async () => {
    const client = fakeClient({ error: { message: "boom" } });
    await expect(listOwnAttendedEventIds(client)).resolves.toEqual(new Set());
  });

  it("fails closed to an empty Set on a malformed response, never trusting it", async () => {
    const client = fakeClient({ data: [{ nonsense: true }] });
    await expect(listOwnAttendedEventIds(client)).resolves.toEqual(new Set());
  });

  it("fails closed to an empty Set on a thrown transport error", async () => {
    const client = {
      async rpc() {
        throw new Error("network down");
      },
    } as unknown as SupabaseClient;
    await expect(listOwnAttendedEventIds(client)).resolves.toEqual(new Set());
  });
});
