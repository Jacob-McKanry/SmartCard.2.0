import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resend } from "resend";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runPendingClaimEmailBatch } from "./pending-claim-emails";

beforeEach(() => {
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-secret-do-not-use-in-prod";
  process.env.EMAIL_MAILING_ADDRESS = "123 Main St, Springfield, ST 00000";
  process.env.KINDE_SITE_URL = "https://smartcard.tech";
});

interface FakeOptions {
  config?: { email_send_batch_size?: number; email_send_concurrency?: number } | null;
  claimedRows?: {
    id: string;
    event_id: string;
    email: string;
    first_name: string | null;
    lookup_token: string;
  }[];
  events?: { id: string; title: string; host_first_name: string | null }[];
  suppressedEmails?: string[];
}

function fakeSupabase(opts: FakeOptions): { client: SupabaseClient; rpcCalls: unknown[] } {
  const rpcCalls: unknown[] = [];
  const config = opts.config === undefined
    ? { email_send_batch_size: 15, email_send_concurrency: 5 }
    : opts.config;

  const client = {
    rpc: vi.fn(async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === "claim_pending_claim_emails") {
        return { data: opts.claimedRows ?? [], error: null };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    }),
    from: vi.fn((table: string) => {
      if (table === "app_config") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => {
              if (config === null) {
                return { data: null, error: { message: "boom" } };
              }
              return {
                data: Object.entries(config).map(([key, value]) => ({ key, value })),
                error: null,
              };
            }),
          })),
        };
      }
      if (table === "events") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => ({
              data: (opts.events ?? []).map((e) => ({
                id: e.id,
                title: e.title,
                host: e.host_first_name === undefined ? null : { first_name: e.host_first_name },
              })),
              error: null,
            })),
          })),
        };
      }
      if (table === "email_suppressions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, value: string) => ({
              maybeSingle: vi.fn(async () => ({
                data: (opts.suppressedEmails ?? []).includes(value) ? { email: value } : null,
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "event_attendee_imports") {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(async () => ({ error: null })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  } as unknown as SupabaseClient;

  return { client, rpcCalls };
}

function fakeResend(): { resend: Pick<Resend, "emails">; sentTo: string[] } {
  const sentTo: string[] = [];
  const resend = {
    emails: {
      send: vi.fn(async (payload: { to: string }) => {
        sentTo.push(payload.to);
        return { data: { id: "email_x" }, error: null };
      }),
    },
  } as unknown as Pick<Resend, "emails">;
  return { resend, sentTo };
}

/**
 * Tracks how many `emails.send` calls are simultaneously in flight, so a
 * test can assert concurrency actually stayed within a bound rather than
 * just checking the eventual totals — which a fully-unbounded `Promise.all`
 * over the whole batch would also satisfy. `await Promise.resolve()` yields
 * once so calls that started "at the same time" are genuinely overlapping in
 * the fake, the same way real network calls would be.
 */
function fakeResendTrackingConcurrency(): {
  resend: Pick<Resend, "emails">;
  maxConcurrent: () => number;
} {
  let inFlight = 0;
  let max = 0;
  const resend = {
    emails: {
      send: vi.fn(async () => {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await Promise.resolve();
        await Promise.resolve();
        inFlight -= 1;
        return { data: { id: "email_x" }, error: null };
      }),
    },
  } as unknown as Pick<Resend, "emails">;
  return { resend, maxConcurrent: () => max };
}

const ROW = (n: number) => ({
  id: `row-${n}`,
  event_id: "event-1",
  email: `guest${n}@example.com`,
  first_name: `Guest${n}`,
  lookup_token: `tok_${n}`,
});

describe("runPendingClaimEmailBatch", () => {
  it("claims and does nothing else when resend is null", async () => {
    const { client, rpcCalls } = fakeSupabase({});
    const result = await runPendingClaimEmailBatch(client, null);
    expect(result).toEqual({ claimed: 0, sent: 0, suppressed: 0, failed: 0 });
    expect(rpcCalls).toHaveLength(0);
  });

  it("does nothing when app_config is missing or invalid, without ever calling claim", async () => {
    const { client, rpcCalls } = fakeSupabase({ config: null });
    const { resend } = fakeResend();
    const result = await runPendingClaimEmailBatch(client, resend);
    expect(result).toEqual({ claimed: 0, sent: 0, suppressed: 0, failed: 0 });
    expect(rpcCalls).toHaveLength(0);
  });

  it("does nothing when app_config has a non-positive value", async () => {
    const { client } = fakeSupabase({ config: { email_send_batch_size: 0, email_send_concurrency: 5 } });
    const { resend } = fakeResend();
    const result = await runPendingClaimEmailBatch(client, resend);
    expect(result).toEqual({ claimed: 0, sent: 0, suppressed: 0, failed: 0 });
  });

  it("passes the configured batch size to claim_pending_claim_emails", async () => {
    const { client, rpcCalls } = fakeSupabase({
      config: { email_send_batch_size: 15, email_send_concurrency: 5 },
    });
    const { resend } = fakeResend();
    await runPendingClaimEmailBatch(client, resend);
    expect(rpcCalls).toEqual([{ fn: "claim_pending_claim_emails", args: { p_limit: 15 } }]);
  });

  it("returns all-zero when nothing is pending", async () => {
    const { client } = fakeSupabase({ claimedRows: [] });
    const { resend } = fakeResend();
    const result = await runPendingClaimEmailBatch(client, resend);
    expect(result).toEqual({ claimed: 0, sent: 0, suppressed: 0, failed: 0 });
  });

  it("sends every claimed row and tallies sent/suppressed correctly", async () => {
    const { client } = fakeSupabase({
      claimedRows: [ROW(1), ROW(2), ROW(3)],
      events: [{ id: "event-1", title: "Founders Dinner", host_first_name: "Jacob" }],
      suppressedEmails: ["guest2@example.com"],
    });
    const { resend, sentTo } = fakeResend();

    const result = await runPendingClaimEmailBatch(client, resend);

    expect(result).toEqual({ claimed: 3, sent: 2, suppressed: 1, failed: 0 });
    expect(sentTo.sort()).toEqual(["guest1@example.com", "guest3@example.com"]);
  });

  it("counts a row as failed, without crashing the batch, when its event can no longer be found", async () => {
    const { client } = fakeSupabase({
      claimedRows: [ROW(1)],
      events: [], // event-1 missing — e.g. deleted between claim and here
    });
    const { resend, sentTo } = fakeResend();

    const result = await runPendingClaimEmailBatch(client, resend);

    expect(result).toEqual({ claimed: 1, sent: 0, suppressed: 0, failed: 1 });
    expect(sentTo).toHaveLength(0);
  });

  it("splits a batch larger than the concurrency into multiple chunks and still sends every row", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ROW(i + 1));
    const { client } = fakeSupabase({
      config: { email_send_batch_size: 15, email_send_concurrency: 3 },
      claimedRows: rows,
      events: [{ id: "event-1", title: "Founders Dinner", host_first_name: "Jacob" }],
    });
    const { resend, sentTo } = fakeResend();

    const result = await runPendingClaimEmailBatch(client, resend);

    expect(result).toEqual({ claimed: 7, sent: 7, suppressed: 0, failed: 0 });
    expect(sentTo).toHaveLength(7);
  });

  it("never has more Resend calls in flight than email_send_concurrency — the actual point of chunking", async () => {
    // A single unbounded Promise.all over the whole 7-row batch would also
    // pass the test above (it sends every row and tallies correctly); this
    // is the assertion that would have caught that regression, since it
    // checks HOW the rows were sent, not just that they all eventually were.
    const rows = Array.from({ length: 7 }, (_, i) => ROW(i + 1));
    const { client } = fakeSupabase({
      config: { email_send_batch_size: 15, email_send_concurrency: 3 },
      claimedRows: rows,
      events: [{ id: "event-1", title: "Founders Dinner", host_first_name: "Jacob" }],
    });
    const { resend, maxConcurrent } = fakeResendTrackingConcurrency();

    const result = await runPendingClaimEmailBatch(client, resend);

    expect(result.sent).toBe(7);
    expect(maxConcurrent()).toBeLessThanOrEqual(3);
    expect(maxConcurrent()).toBeGreaterThan(1); // genuinely concurrent, not accidentally sequential
  });
});
