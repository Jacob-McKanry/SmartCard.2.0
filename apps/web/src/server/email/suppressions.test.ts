import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { isEmailSuppressed, recordSuppression } from "./suppressions";

/**
 * `email_suppressions` has no RLS policy and no RPC — see the migration's own
 * header — so this is the first server module in this codebase to query it
 * with plain `.from()` calls instead of `.rpc()`. The fakes below mimic only
 * the exact chain each function actually calls, which is why they differ from
 * `fakeRpcClient` used everywhere else in this codebase.
 */

function fakeSelectClient(answer: {
  data?: unknown;
  error?: { message: string } | null;
}): { client: SupabaseClient; eqArgs: unknown[] } {
  const eqArgs: unknown[] = [];
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((...args: unknown[]) => {
          eqArgs.push(args);
          return {
            maybeSingle: vi.fn(async () => ({
              data: answer.data ?? null,
              error: answer.error ?? null,
            })),
          };
        }),
      })),
    })),
  } as unknown as SupabaseClient;
  return { client, eqArgs };
}

function fakeInsertClient(answer: { error?: { code?: string; message: string } | null }): {
  client: SupabaseClient;
  inserted: unknown[];
} {
  const inserted: unknown[] = [];
  const client = {
    from: vi.fn(() => ({
      insert: vi.fn(async (row: unknown) => {
        inserted.push(row);
        return { error: answer.error ?? null };
      }),
    })),
  } as unknown as SupabaseClient;
  return { client, inserted };
}

describe("isEmailSuppressed", () => {
  it("lowercases the address before matching", async () => {
    const { client, eqArgs } = fakeSelectClient({ data: null });
    await isEmailSuppressed(client, "Sarah@Example.com");
    expect(eqArgs).toEqual([["email", "sarah@example.com"]]);
  });

  it("answers false when no row matches", async () => {
    const { client } = fakeSelectClient({ data: null });
    await expect(isEmailSuppressed(client, "nobody@example.com")).resolves.toBe(false);
  });

  it("answers true when a row matches", async () => {
    const { client } = fakeSelectClient({ data: { email: "sarah@example.com" } });
    await expect(isEmailSuppressed(client, "sarah@example.com")).resolves.toBe(true);
  });

  it("fails CLOSED (true) on a read error, the correct direction for a do-not-mail list", async () => {
    const { client } = fakeSelectClient({ error: { message: "boom" } });
    await expect(isEmailSuppressed(client, "sarah@example.com")).resolves.toBe(true);
  });
});

describe("recordSuppression", () => {
  it("writes the lowercased address, reason and source event id", async () => {
    const { client, inserted } = fakeInsertClient({});
    await recordSuppression(client, "Sarah@Example.com", "bounced", "evt_123");
    expect(inserted).toEqual([
      { email: "sarah@example.com", reason: "bounced", source_event_id: "evt_123" },
    ]);
  });

  it("nulls the source event id when omitted (the unsubscribe-link caller)", async () => {
    const { client, inserted } = fakeInsertClient({});
    await recordSuppression(client, "sarah@example.com", "unsubscribed");
    expect(inserted).toEqual([
      { email: "sarah@example.com", reason: "unsubscribed", source_event_id: null },
    ]);
  });

  it("treats a duplicate-key error (23505) as success, not a failure", async () => {
    const { client } = fakeInsertClient({ error: { code: "23505", message: "duplicate" } });
    await expect(recordSuppression(client, "sarah@example.com", "bounced")).resolves.toBeUndefined();
  });

  it("throws on any other error", async () => {
    const { client } = fakeInsertClient({ error: { code: "55000", message: "boom" } });
    await expect(recordSuppression(client, "sarah@example.com", "bounced")).rejects.toThrow(/boom/);
  });
});
