import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resend } from "resend";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendClaimEmail } from "./send-claim-email";

beforeEach(() => {
  process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-secret-do-not-use-in-prod";
  process.env.EMAIL_MAILING_ADDRESS = "123 Main St, Springfield, ST 00000";
  process.env.KINDE_SITE_URL = "https://smartcard.tech";
});

interface UpdateCall {
  fields: Record<string, unknown>;
  id: string;
}

function fakeSupabase(opts: {
  suppressed?: boolean;
  updateError?: { message: string } | null;
}): { client: SupabaseClient; updateCalls: UpdateCall[] } {
  const updateCalls: UpdateCall[] = [];
  const client = {
    from: vi.fn((table: string) => {
      if (table === "email_suppressions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: opts.suppressed ? { email: "suppressed" } : null,
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "event_attendee_imports") {
        return {
          update: vi.fn((fields: Record<string, unknown>) => ({
            eq: vi.fn((_col: string, id: string) => ({
              is: vi.fn(async () => {
                updateCalls.push({ fields, id });
                return { error: opts.updateError ?? null };
              }),
            })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  } as unknown as SupabaseClient;
  return { client, updateCalls };
}

function fakeResend(answer: { error?: { message: string } | null }): {
  resend: Pick<Resend, "emails">;
  calls: Record<string, unknown>[];
} {
  const calls: Record<string, unknown>[] = [];
  const resend = {
    emails: {
      send: vi.fn(async (payload: Record<string, unknown>) => {
        calls.push(payload);
        return answer.error
          ? { data: null, error: answer.error }
          : { data: { id: "email_123" }, error: null };
      }),
    },
  } as unknown as Pick<Resend, "emails">;
  return { resend, calls };
}

const EVENT = { title: "Founders Dinner", hostFirstName: "Jacob" };
const ROW = { id: "import-row-1", email: "sarah@example.com", firstName: "Sarah", lookupToken: "tok_abc123" };

describe("sendClaimEmail", () => {
  it("skips Resend entirely and writes email_error='suppressed' for a suppressed address", async () => {
    const { client, updateCalls } = fakeSupabase({ suppressed: true });
    const { resend, calls } = fakeResend({});

    const result = await sendClaimEmail({ supabase: client, resend }, EVENT, ROW);

    expect(result).toEqual({ outcome: "suppressed" });
    expect(calls).toHaveLength(0);
    expect(updateCalls).toEqual([{ fields: { email_error: "suppressed" }, id: "import-row-1" }]);
  });

  it("sends via Resend and records emailed_at on success", async () => {
    const { client, updateCalls } = fakeSupabase({});
    const { resend, calls } = fakeResend({});

    const result = await sendClaimEmail({ supabase: client, resend }, EVENT, ROW);

    expect(result).toEqual({ outcome: "sent" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.to).toBe("sarah@example.com");
    expect(calls[0]?.subject).toBe("Jacob added you to the guest list for Founders Dinner");
    expect((calls[0]?.html as string)).toContain("https://smartcard.tech/claim/tok_abc123");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.id).toBe("import-row-1");
    expect(updateCalls[0]?.fields.email_error).toBeNull();
    expect(typeof updateCalls[0]?.fields.emailed_at).toBe("string");
  });

  it("attaches List-Unsubscribe headers pointed at the signed unsubscribe link", async () => {
    const { client } = fakeSupabase({});
    const { resend, calls } = fakeResend({});

    await sendClaimEmail({ supabase: client, resend }, EVENT, ROW);

    const headers = calls[0]?.headers as Record<string, string>;
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(headers["List-Unsubscribe"]).toContain("/api/unsubscribe?email=sarah%40example.com&sig=");
  });

  it("records email_error and returns failed when Resend refuses the send", async () => {
    const { client, updateCalls } = fakeSupabase({});
    const { resend } = fakeResend({ error: { message: "invalid `to` field" } });

    const result = await sendClaimEmail({ supabase: client, resend }, EVENT, ROW);

    expect(result).toEqual({ outcome: "failed", error: "invalid `to` field" });
    expect(updateCalls).toEqual([
      { fields: { email_error: "invalid `to` field" }, id: "import-row-1" },
    ]);
  });

  it("does not throw when the write-back itself fails — the send already happened", async () => {
    const { client } = fakeSupabase({ updateError: { message: "db unavailable" } });
    const { resend } = fakeResend({});

    await expect(sendClaimEmail({ supabase: client, resend }, EVENT, ROW)).resolves.toEqual({
      outcome: "sent",
    });
  });

  it("greets generically and still sends when the row has no first name", async () => {
    const { client } = fakeSupabase({});
    const { resend, calls } = fakeResend({});

    const result = await sendClaimEmail(
      { supabase: client, resend },
      EVENT,
      { ...ROW, firstName: null },
    );

    expect(result).toEqual({ outcome: "sent" });
    expect(calls[0]?.text as string).toMatch(/^Hi,/);
  });
});
