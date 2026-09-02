import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { UserFacingError } from "@/server/errors";

import { cancelEvent, deleteDraftEvent } from "./events-service";

/**
 * `cancelEvent` and `deleteDraftEvent`, tested as the translation layer they
 * are — same shape `publish-event.test.ts` uses for its own RPC wrapper.
 *
 * The interesting half is not here. Whether the caller hosts the event,
 * whether it exists, and whether it is currently in the right starting
 * status (`scheduled` for cancel, `draft` for delete) are all decided inside
 * `public.cancel_event`/`public.delete_draft_event` (20260902120000) from
 * values each reads itself — verified live in a rolled-back transaction
 * across 10 scenarios before either was applied. What this file owns is each
 * RPC call and turning its one refusal code into a sentence.
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

describe("cancelEvent", () => {
  it("sends the event id and nothing else", async () => {
    const { client, calls } = fakeClient({ data: null });
    await cancelEvent(client, "event-1");
    expect(calls).toEqual([{ fn: "cancel_event", args: { p_event_id: "event-1" } }]);
  });

  it("resolves with no error on success", async () => {
    const { client } = fakeClient({ data: null });
    await expect(cancelEvent(client, "event-1")).resolves.toBeUndefined();
  });

  it("turns 42501 into one sentence covering not-yours, not-found, draft, and already-cancelled alike", async () => {
    const { client } = fakeClient({ error: { code: "42501", message: "not authorized" } });

    const error = await cancelEvent(client, "event-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).not.toMatch(/not authorized/i);
    expect((error as Error).message).toMatch(/can't be cancelled/i);
  });

  it("gives an unrecognised database error the generic sentence, not its own words", async () => {
    const { client } = fakeClient({
      error: { code: "55000", message: 'relation "public.events" broke' },
    });
    const error = await cancelEvent(client, "event-1").catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(UserFacingError);
  });
});

describe("deleteDraftEvent", () => {
  it("sends the event id and nothing else", async () => {
    const { client, calls } = fakeClient({ data: null });
    await deleteDraftEvent(client, "event-1");
    expect(calls).toEqual([{ fn: "delete_draft_event", args: { p_event_id: "event-1" } }]);
  });

  it("resolves with no error on success", async () => {
    const { client } = fakeClient({ data: null });
    await expect(deleteDraftEvent(client, "event-1")).resolves.toBeUndefined();
  });

  it("turns 42501 into one sentence covering not-yours, not-found, and already-published alike", async () => {
    const { client } = fakeClient({ error: { code: "42501", message: "not authorized" } });

    const error = await deleteDraftEvent(client, "event-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).not.toMatch(/not authorized/i);
    expect((error as Error).message).toMatch(/can't be deleted/i);
  });

  it("gives an unrecognised database error the generic sentence, not its own words", async () => {
    const { client } = fakeClient({
      error: { code: "55000", message: 'relation "public.events" broke' },
    });
    const error = await deleteDraftEvent(client, "event-1").catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(UserFacingError);
  });
});
