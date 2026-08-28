import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { countCitiesMetIn } from "./cities-count";

/**
 * The cities count's TypeScript half, tested as the one property it owns:
 * A NUMBER IT DOES NOT RECOGNISE IS A FAILURE, NEVER A ZERO.
 *
 * Not tested here: the dedupe, the null-city exclusion, and the fact that one
 * user never sees another's cities. Those live in `own_cities_met_in()`
 * (20260828180000) and were verified against the live database in a
 * rolled-back transaction — two meetings in one city counting once, a
 * null-city meeting excluded, and three separate users each seeing only their
 * own total. Same posture `attendee-import.test.ts` states for its own RPC: a
 * Vitest run has no database, and a mock that "checks" one of those would only
 * be checking the mock.
 */

function fakeClient(answer: { data?: unknown; error?: { message: string } }): SupabaseClient {
  return {
    async rpc() {
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  } as unknown as SupabaseClient;
}

describe("countCitiesMetIn", () => {
  it("returns the count the RPC gave", async () => {
    await expect(countCitiesMetIn(fakeClient({ data: 3 }))).resolves.toBe(3);
  });

  it("returns a real zero when the RPC genuinely answered zero", async () => {
    // The distinction this module is built around: a zero the DATABASE
    // asserted is a fact and is drawn. Only a zero this code invented after a
    // failure would be a claim nobody made.
    await expect(countCitiesMetIn(fakeClient({ data: 0 }))).resolves.toBe(0);
  });

  it("throws on an RPC error rather than reporting zero cities", async () => {
    await expect(countCitiesMetIn(fakeClient({ error: { message: "boom" } }))).rejects.toThrow(
      /Failed to count cities/,
    );
  });

  it("throws on a null answer — a missing number is not zero", async () => {
    await expect(countCitiesMetIn(fakeClient({ data: null }))).rejects.toThrow(/unexpected shape/);
  });

  it("throws on a non-numeric answer rather than coercing it", async () => {
    await expect(countCitiesMetIn(fakeClient({ data: "3" }))).rejects.toThrow(/unexpected shape/);
    await expect(countCitiesMetIn(fakeClient({ data: [3] }))).rejects.toThrow(/unexpected shape/);
  });

  it("throws on NaN, which is a number and is still not an answer", async () => {
    await expect(countCitiesMetIn(fakeClient({ data: Number.NaN }))).rejects.toThrow(
      /unexpected shape/,
    );
  });
});
