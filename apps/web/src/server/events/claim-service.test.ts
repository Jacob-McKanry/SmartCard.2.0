import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { claimEventImport, getClaimableImport } from "./claim-service";

/**
 * C4's service layer, tested as the one property it owns: EVERY WAY
 * `getClaimableImport` CAN FAIL COLLAPSES TO THE IDENTICAL `{available:
 * false}` SHAPE.
 *
 * What is NOT tested here: whether a token resolves to a live row, whether
 * an email matches, whether either rate limit trips. Those are
 * `get_claimable_import` / `claim_event_import`'s own job (20260828120000,
 * 20260828130000, 20260828140000), verified live in a rolled-back
 * transaction per those migrations' own headers. A Vitest run has no
 * database and a mock that "checks" a gate would only be checking a mock —
 * same posture `attendee-import.test.ts` states for the sibling RPC.
 */

// Silence expected console.error noise from the fail-closed paths below so a
// real run's output stays readable.
vi.spyOn(console, "error").mockImplementation(() => undefined);

function fakeClient(answer: { data?: unknown; error?: { code?: string; message: string } }): {
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

const AVAILABLE_CLAIMABLE = {
  available: true,
  event_id: "11111111-1111-4111-8111-111111111111",
  event_name: "Founders Dinner",
  host_first_name: "Jacob",
  host_last_name: "McKanry",
  can_claim: true,
  prefill: {
    first_name: "Kim",
    last_name: "Alvarez",
    phone_number: null,
    company_name: "Northwind",
    company_role: null,
    social_links: [],
  },
};

describe("getClaimableImport", () => {
  it("passes through a real `{available: true}` response unchanged", async () => {
    const { client } = fakeClient({ data: AVAILABLE_CLAIMABLE });
    const result = await getClaimableImport(client, "tok");
    expect(result).toEqual(AVAILABLE_CLAIMABLE);
  });

  it("passes through `{available: false}`", async () => {
    const { client } = fakeClient({ data: { available: false } });
    const result = await getClaimableImport(client, "tok");
    expect(result).toEqual({ available: false });
  });

  // §3.6: a missing app_config row surfaces as a THROWN 55000
  // (20260828120000's header), not a graceful jsonb answer. If this ever
  // leaked through as a thrown error instead of the same refusal shape, a
  // caller could tell "misconfigured" apart from "bad token" by which one
  // 500s versus which one renders the "not available" screen.
  it("collapses an RPC error (e.g. missing rate-limit config, 55000) to `{available: false}`", async () => {
    const { client } = fakeClient({ error: { code: "55000", message: "claim lookup configuration missing" } });
    const result = await getClaimableImport(client, "tok");
    expect(result).toEqual({ available: false });
  });

  it("collapses a thrown transport error to `{available: false}`", async () => {
    const client = {
      async rpc() {
        throw new Error("network down");
      },
    } as unknown as SupabaseClient;

    const result = await getClaimableImport(client, "tok");
    expect(result).toEqual({ available: false });
  });

  it("collapses an unrecognised response shape to `{available: false}`, never treating it as available", async () => {
    const { client } = fakeClient({ data: { unexpected: "shape" } });
    const result = await getClaimableImport(client, "tok");
    expect(result).toEqual({ available: false });
  });

  it("collapses `available: true` with a missing required field to `{available: false}`", async () => {
    // event_id absent — the exact shape a caller still running the
    // pre-20260828140000 function would return. Must not be trusted as
    // available with a hole in it.
    const { client } = fakeClient({
      data: { available: true, event_name: "X", can_claim: false, prefill: null },
    });
    const result = await getClaimableImport(client, "tok");
    expect(result).toEqual({ available: false });
  });

  it("passes the lookup token through as p_lookup_token, unmodified", async () => {
    const { client, calls } = fakeClient({ data: { available: false } });
    await getClaimableImport(client, "raw-token-value");
    expect(calls).toEqual([{ fn: "get_claimable_import", args: { p_lookup_token: "raw-token-value" } }]);
  });

  it("never throws, regardless of failure mode", async () => {
    const client = {
      async rpc() {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;
    await expect(getClaimableImport(client, "tok")).resolves.toEqual({ available: false });
  });
});

describe("claimEventImport", () => {
  it("returns {claimed: true} on a real claim", async () => {
    const { client } = fakeClient({ data: { claimed: true } });
    const result = await claimEventImport(client, "tok", { first_name: true });
    expect(result).toEqual({ claimed: true });
  });

  it("returns {claimed: false} for a refused claim — a normal outcome, not a throw", async () => {
    const { client } = fakeClient({ data: { claimed: false } });
    const result = await claimEventImport(client, "tok", {});
    expect(result).toEqual({ claimed: false });
  });

  // Distinguishing "we could not ask" from "we asked and the answer was no"
  // matters to the Server Action calling this: only the former should offer
  // a retry framed as a transient failure.
  it("throws on an RPC transport error, unlike a logical refusal", async () => {
    const { client } = fakeClient({ error: { message: "connection reset" } });
    await expect(claimEventImport(client, "tok", {})).rejects.toThrow(/Failed to claim/);
  });

  it("throws on an unrecognised response shape rather than reading it as claimed", async () => {
    const { client } = fakeClient({ data: { unexpected: "shape" } });
    await expect(claimEventImport(client, "tok", {})).rejects.toThrow();
  });

  it("forwards the token and approved fields as p_lookup_token / p_approved_fields", async () => {
    const { client, calls } = fakeClient({ data: { claimed: true } });
    const approved = { first_name: true, last_name: false, social_links: true };
    await claimEventImport(client, "raw-token", approved);
    expect(calls).toEqual([
      { fn: "claim_event_import", args: { p_lookup_token: "raw-token", p_approved_fields: approved } },
    ]);
  });
});
