import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { UserFacingError } from "@/server/errors";

import { publishEvent } from "./events-service";

/**
 * `publishEvent`, tested as the translation layer it is — the same shape
 * `attendee-import-service.test.ts` and `import-links.test.ts` use for their
 * own RPC wrappers.
 *
 * The interesting half is not here. Whether the caller hosts the event,
 * whether it exists, and whether it is currently a draft are all decided
 * inside `public.publish_event` (20260830150000) from values it reads itself
 * — verified live in a rolled-back transaction (scenarios 8-12 of that
 * migration's verification run) before it was applied. What this file owns is
 * the one RPC call and turning its one refusal code into a sentence.
 */

interface RpcCall {
  fn: string;
  args: unknown;
}

function fakeClient(answer: {
  data?: unknown;
  error?: { code?: string; message: string };
}): { client: SupabaseClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const client = {
    async rpc(fn: string, args?: unknown) {
      calls.push({ fn, args });
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("publishEvent", () => {
  it("sends the event id and nothing else", async () => {
    const { client, calls } = fakeClient({ data: null });

    await publishEvent(client, "event-1");

    expect(calls).toEqual([{ fn: "publish_event", args: { p_event_id: "event-1" } }]);
  });

  it("resolves with no error on success", async () => {
    const { client } = fakeClient({ data: null });
    await expect(publishEvent(client, "event-1")).resolves.toBeUndefined();
  });

  it("turns 42501 into one sentence covering not-yours, not-found, and already-published alike", async () => {
    const { client } = fakeClient({ error: { code: "42501", message: "not authorized" } });

    const error = await publishEvent(client, "event-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    // The database's own words never reach the browser — the RPC's message
    // ("not authorized") is nowhere in what a person sees.
    expect((error as Error).message).not.toMatch(/not authorized/i);
    // One sentence, naming no specific cause. The RPC deliberately answers
    // "not your event", "no such event" and "already published" identically
    // so a guessed id cannot be used to learn which is true, and a message
    // written as three separate branches here would rebuild that probe in
    // the UI even though the database refused to.
    expect((error as Error).message).toMatch(/can't be published/i);
  });

  it("gives an unrecognised database error the generic sentence, not its own words", async () => {
    const { client } = fakeClient({
      error: { code: "55000", message: 'relation "public.events" broke' },
    });

    const error = await publishEvent(client, "event-1").catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(UserFacingError);
  });
});
