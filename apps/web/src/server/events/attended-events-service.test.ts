import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { listOwnAttendedEventIds, listOwnAttendedEvents } from "./attended-events-service";

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

/**
 * `listOwnAttendedEvents` — the full-events counterpart that powers "My
 * events" → Attending (`app/(app)/events/mine/page.tsx`). Deliberately tested
 * for the OPPOSITE failure posture from `listOwnAttendedEventIds` above: this
 * one throws, because it is the one thing a whole list screen renders — see
 * this function's own header for why an empty result and a failed read must
 * not look the same here.
 */
function fakeEventsClient(args: {
  rpc: { data?: unknown; error?: { message: string } };
  events?: { data?: unknown; error?: { message: string } };
}): SupabaseClient {
  return {
    async rpc() {
      return { data: args.rpc.data ?? null, error: args.rpc.error ?? null };
    },
    from() {
      return {
        select() {
          return {
            in: async () => ({
              data: args.events?.data ?? null,
              error: args.events?.error ?? null,
            }),
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function eventRow(id: string): Record<string, unknown> {
  return {
    id,
    host_user_id: "host-1",
    city_id: "city-1",
    title: `Event ${id}`,
    description: null,
    starts_at: "2026-09-10T00:00:00Z",
    ends_at: null,
    timezone: "UTC",
    venue_name: null,
    venue_address: null,
    latitude: null,
    longitude: null,
    visibility: "private",
    capacity: null,
    requires_approval: false,
    cover_image_path: null,
    status: "scheduled",
    cancelled_at: null,
    cancelled_reason: null,
    created_at: "2026-09-01T00:00:00Z",
    cities: { id: "city-1", slug: "sf", name: "San Francisco", state: "CA" },
  };
}

describe("listOwnAttendedEvents", () => {
  it("returns [] without querying events when the caller has claimed nothing", async () => {
    const client = fakeEventsClient({ rpc: { data: [] } });
    await expect(listOwnAttendedEvents(client)).resolves.toEqual([]);
  });

  it("returns the full events, most-recently-claimed first", async () => {
    const client = fakeEventsClient({
      rpc: {
        data: [
          { event_id: EVENT_A, claimed_at: "2026-08-20T00:00:00Z" },
          { event_id: EVENT_B, claimed_at: "2026-08-28T00:00:00Z" },
        ],
      },
      events: { data: [eventRow(EVENT_A), eventRow(EVENT_B)] },
    });

    const result = await listOwnAttendedEvents(client);
    expect(result.map((item) => item.event.id)).toEqual([EVENT_B, EVENT_A]);
    expect(result[0]?.city).toEqual({ id: "city-1", slug: "sf", name: "San Francisco", state: "CA" });
  });

  it("throws, never fails closed to [], on an RPC error", async () => {
    const client = fakeEventsClient({ rpc: { error: { message: "boom" } } });
    await expect(listOwnAttendedEvents(client)).rejects.toThrow(/Failed to load the events you attended/);
  });

  it("throws on a malformed RPC response", async () => {
    const client = fakeEventsClient({ rpc: { data: [{ nonsense: true }] } });
    await expect(listOwnAttendedEvents(client)).rejects.toThrow(/unexpected shape/);
  });

  it("throws when the events read itself fails", async () => {
    const client = fakeEventsClient({
      rpc: { data: [{ event_id: EVENT_A, claimed_at: "2026-08-20T00:00:00Z" }] },
      events: { error: { message: "down" } },
    });
    await expect(listOwnAttendedEvents(client)).rejects.toThrow(/Failed to load the events you attended/);
  });
});
