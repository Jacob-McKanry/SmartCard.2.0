import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { UserFacingError } from "@/server/errors";

import { IMPORT_LINKS_PAGE_SIZE, listOwnImportLinks } from "./attendee-import-service";

/**
 * THE INTERIM CLAIM-LINK LIST, TESTED AS THE THREE PROPERTIES THIS SIDE OWNS.
 *
 * As with `attendee-import.test.ts`, the interesting half of this feature is
 * not in this file and saying so precisely matters. Whether the caller is an
 * active verified host, whether they host this event, and — the one that makes
 * this whole deviation acceptable — whether they are the account that actually
 * IMPORTED each row are all decided inside `public.list_own_import_links`
 * (20260829120000) from values it reads itself. Those were verified against the
 * live database in a rolled-back transaction across 12 scenarios, including the
 * one §3.8 originally objected to: a host who takes the event over later reads
 * nothing from the previous host's import. A Vitest run has no database and a
 * mock that "checked" a gate would only be checking the mock.
 *
 * What this file owns:
 *
 *   1. WHAT IS ASKED FOR. The page size the screen renders and the offset it
 *      asks for have to be the ones sent, or paging silently repeats or skips
 *      guests — and a skipped guest is one who never gets their link.
 *
 *   2. WHAT COMES BACK IS WHAT IT CLAIMS TO BE. This response carries claim
 *      tokens that get pasted into a URL and sent to a real person, so a shape
 *      that quietly disagreed would produce `/claim/undefined` and the host
 *      would send it before anybody noticed. Parsed, never cast.
 *
 *   3. THAT IT THROWS RATHER THAN FAILING TO AN EMPTY PAGE. This is the
 *      property most likely to be "fixed" into a bug by a future reader
 *      copying `listOwnAttendedEventIds`, which correctly does the opposite.
 *      An empty page is a real answer here — everybody has claimed — so
 *      returning it when the truth is "we could not ask" would tell a host
 *      their guests are all sorted and stop them sending anything.
 */

const EVENT_ID = "44444444-4444-4444-8444-444444444444";

interface RpcCall {
  fn: string;
  args: unknown;
}

function fakeClient(answer: {
  data?: unknown;
  error?: { code?: string; message: string };
  throws?: Error;
}): { client: SupabaseClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const client = {
    async rpc(fn: string, args?: unknown) {
      calls.push({ fn, args });
      if (answer.throws !== undefined) {
        throw answer.throws;
      }
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

const PAGE = {
  unclaimed_total: 3,
  links: [
    {
      first_name: "Kim",
      last_name: "Alvarez",
      email: "kim@example.com",
      lookup_token: "a".repeat(64),
    },
    { first_name: null, last_name: null, email: "noname@example.com", lookup_token: "b".repeat(64) },
  ],
};

// ---------------------------------------------------------------------------
// 1. What is asked for
// ---------------------------------------------------------------------------

describe("the call the service actually makes", () => {
  it("sends the event, the screen's page size, and the offset it was given", async () => {
    const { client, calls } = fakeClient({ data: PAGE });

    await listOwnImportLinks(client, EVENT_ID, 50);

    expect(calls).toEqual([
      {
        fn: "list_own_import_links",
        args: { p_event_id: EVENT_ID, p_limit: IMPORT_LINKS_PAGE_SIZE, p_offset: 50 },
      },
    ]);
  });

  it("starts at the first row when no offset is given", async () => {
    const { client, calls } = fakeClient({ data: PAGE });

    await listOwnImportLinks(client, EVENT_ID);

    expect((calls[0]?.args as { p_offset: number }).p_offset).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. What comes back
// ---------------------------------------------------------------------------

describe("the answer", () => {
  it("returns the page as the RPC gave it", async () => {
    const { client } = fakeClient({ data: PAGE });

    await expect(listOwnImportLinks(client, EVENT_ID)).resolves.toEqual(PAGE);
  });

  it("accepts a row with no name at all — a guest list may carry only an email", async () => {
    const { client } = fakeClient({
      data: {
        unclaimed_total: 1,
        links: [
          { first_name: null, last_name: null, email: "x@example.com", lookup_token: "t" },
        ],
      },
    });

    const page = await listOwnImportLinks(client, EVENT_ID);
    expect(page.links[0]?.first_name).toBeNull();
    expect(page.links[0]?.email).toBe("x@example.com");
  });

  it("accepts an empty page — everybody having claimed is a real answer", async () => {
    const { client } = fakeClient({ data: { unclaimed_total: 0, links: [] } });

    await expect(listOwnImportLinks(client, EVENT_ID)).resolves.toEqual({
      unclaimed_total: 0,
      links: [],
    });
  });

  it("refuses a response missing the token, rather than rendering /claim/undefined", async () => {
    const { client } = fakeClient({
      data: { unclaimed_total: 1, links: [{ first_name: "Kim", last_name: null, email: "k@e.com" }] },
    });

    await expect(listOwnImportLinks(client, EVENT_ID)).rejects.toThrow(/unexpected shape/);
  });

  it("refuses a response that is not a page at all", async () => {
    const { client } = fakeClient({ data: [] });

    await expect(listOwnImportLinks(client, EVENT_ID)).rejects.toThrow(/unexpected shape/);
  });
});

// ---------------------------------------------------------------------------
// 3. Refusals: thrown, and written for a person
// ---------------------------------------------------------------------------

describe("turning the database's refusals into sentences", () => {
  it("throws rather than answering with an empty page", async () => {
    const { client } = fakeClient({ error: { code: "42501", message: "not authorized" } });

    // The property, stated as the assertion a future reader will trip over if
    // they "fix" this to fail closed to `{unclaimed_total: 0, links: []}`.
    await expect(listOwnImportLinks(client, EVENT_ID)).rejects.toThrow();
  });

  it("keeps 42501 merged across every reason the RPC refuses for", async () => {
    const { client } = fakeClient({ error: { code: "42501", message: "not authorized" } });

    const error = await listOwnImportLinks(client, EVENT_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    // One sentence, naming no specific cause. "Not a verified host", "not your
    // event" and "no such event" all land here, so a friendlier split would
    // rebuild the event-existence probe §3.6 rules out.
    expect((error as Error).message).toMatch(/verified host account and an event you're hosting/);
  });

  it("names no number in the rate-limit message", async () => {
    const { client } = fakeClient({ error: { code: "53400", message: "too many requests" } });

    const error = await listOwnImportLinks(client, EVENT_ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserFacingError);
    // `app_config` is unreadable to `authenticated`, so any figure written on
    // this side is a copy that goes stale the moment the real one is raised.
    expect((error as Error).message).not.toMatch(/\d/);
  });

  it("gives an unrecognised database error the generic sentence, not its own words", async () => {
    const { client } = fakeClient({
      error: { code: "55000", message: 'relation "public.event_attendee_imports" has no policy' },
    });

    const error = await listOwnImportLinks(client, EVENT_ID).catch((e: unknown) => e);
    // Not a UserFacingError, so `@/server/errors` replaces it before it can
    // reach a browser carrying a table name.
    expect(error).not.toBeInstanceOf(UserFacingError);
  });

  it("lets a transport failure through rather than swallowing it", async () => {
    const { client } = fakeClient({ throws: new Error("network down") });

    await expect(listOwnImportLinks(client, EVENT_ID)).rejects.toThrow(/network down/);
  });
});
