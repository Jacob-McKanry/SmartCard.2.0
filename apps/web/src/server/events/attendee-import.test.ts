import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { UserFacingError } from "@/server/errors";

import { importEventAttendees } from "./attendee-import-service";

/**
 * GUEST-LIST IMPORT, TESTED AS THE THREE PROPERTIES THE SERVICE LAYER OWNS.
 *
 * It is worth being precise about what is NOT tested here, because the
 * interesting half of this feature is not in this file. Whether the caller is
 * an active verified host, whether they host this specific non-cancelled event,
 * whether the file is inside the row cap, and whether they have any of today's
 * ten imports left are decided inside `public.import_event_attendees`
 * (20260827130000) from values it reads itself. Those were verified against the
 * live database in a rolled-back transaction as real users with real policies
 * in force — see that migration's header for the two runs and what each
 * asserted. A Vitest run has no database and cannot re-assert any of it, and a
 * mock that "checks" a gate would only be checking a mock.
 *
 * What this file owns is the translation layer either side of that call:
 *
 *   1. WHAT REACHES THE DATABASE. The RPC reads each row with
 *      `v_row ->> 'first_name'`, which answers `null` for a key that is
 *      missing, misspelled or holds an object — so a mis-built payload does not
 *      fail, it silently imports a guest list with every name blank and the
 *      host finds out when the emails go out. The shape check has to hold.
 *
 *   2. WHAT NEVER REACHES THE DATABASE. A missing attestation and an empty list
 *      are both refused before the call. That is not belt-and-braces: the RPC
 *      consumes the host's daily import budget *before* doing the work,
 *      deliberately, so that probing is not free — which means letting either
 *      through would spend one of ten daily imports on nothing.
 *
 *   3. WHAT REACHES THE BROWSER. Every refusal the database can raise has to
 *      come back as a sentence written for a person, and no refusal may carry
 *      the database's own words, which name tables, columns and policies
 *      (`@/server/errors`). The `42501` case additionally has to stay merged:
 *      the RPC answers identically for "not a verified host" and "not your
 *      event" so that a guessed event id cannot be used to find out whether it
 *      exists, and a friendlier split here would rebuild that probe in the UI.
 */

const EVENT_ID = "44444444-4444-4444-8444-444444444444";

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

/** A complete, valid row. Every test starts here and breaks one thing. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: "kim@example.com",
    first_name: "Kim",
    last_name: "Alvarez",
    phone_number: null,
    company_name: "Northwind",
    company_role: null,
    social_links: [{ platform: "instagram", url: "@kim" }],
    ...over,
  };
}

const SUMMARY = {
  imported: 3,
  updated: 1,
  skipped_no_email: 2,
  skipped_already_claimed: 1,
};

// ---------------------------------------------------------------------------
// 1. What reaches the database
// ---------------------------------------------------------------------------

describe("the call the service actually makes", () => {
  it("sends the three named parameters and nothing else", async () => {
    const { client, calls } = fakeClient({ data: SUMMARY });

    await importEventAttendees(client, EVENT_ID, [row()], true);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.fn).toBe("import_event_attendees");
    expect(calls[0]?.args).toStrictEqual({
      p_event_id: EVENT_ID,
      p_rows: [row()],
      p_attested: true,
    });
  });

  it("returns the summary the database computed, unaltered", async () => {
    const { client } = fakeClient({ data: SUMMARY });

    await expect(importEventAttendees(client, EVENT_ID, [row()], true)).resolves.toStrictEqual(
      SUMMARY,
    );
  });

  it("accepts a row carrying nothing but an email, which is a real guest list", async () => {
    const { client, calls } = fakeClient({ data: SUMMARY });
    const bare = {
      email: "nothing-else@example.com",
      first_name: null,
      last_name: null,
      phone_number: null,
      company_name: null,
      company_role: null,
      social_links: [],
    };

    await importEventAttendees(client, EVENT_ID, [bare], true);

    expect((calls[0]?.args as { p_rows: unknown[] }).p_rows).toStrictEqual([bare]);
  });

  it("accepts an address the database would accept, even though it is not RFC-valid", async () => {
    // The database's rule is `position('@' in email) > 0` after trimming, and
    // `normaliseImportRows` applies the same one. A stricter check here would
    // reject rows the import path is designed to accept, and would put the
    // definition of "usable address" in a third place.
    const { client, calls } = fakeClient({ data: SUMMARY });

    await importEventAttendees(client, EVENT_ID, [row({ email: "kim@localhost" })], true);

    expect(calls).toHaveLength(1);
  });
});

describe("a payload that is not the shape the RPC reads", () => {
  it.each([
    ["not an array at all", { email: "kim@example.com" }],
    ["a row that is a string", ["kim@example.com"]],
    ["a row with no email key", [row({ email: undefined })]],
    ["a row whose email is a number", [row({ email: 42 })]],
    ["a row whose first_name is an object", [row({ first_name: { given: "Kim" } })]],
    ["a row whose social_links is a string", [row({ social_links: "@kim" })]],
    ["a social link missing its url", [row({ social_links: [{ platform: "instagram" }] })]],
  ])("refuses %s, and never calls the database", async (_label, payload) => {
    const { client, calls } = fakeClient({ data: SUMMARY });

    await expect(importEventAttendees(client, EVENT_ID, payload, true)).rejects.toBeInstanceOf(
      UserFacingError,
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses a row carrying a key this contract does not have", async () => {
    // `.strict()`, and this is the test that pins why. An extra key is the
    // signal that a column the mapping screen was supposed to drop is still
    // attached — most plausibly PII nobody meant to send. The RPC would ignore
    // it, but ignoring is not the behaviour to want from an import path.
    const { client, calls } = fakeClient({ data: SUMMARY });

    await expect(
      importEventAttendees(client, EVENT_ID, [row({ dietary_requirements: "vegan" })], true),
    ).rejects.toBeInstanceOf(UserFacingError);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. What never reaches the database
// ---------------------------------------------------------------------------

describe("the attestation", () => {
  it("is refused here rather than at the database, so a bug does not cost the host an import", async () => {
    const { client, calls } = fakeClient({ data: SUMMARY });

    await expect(importEventAttendees(client, EVENT_ID, [row()], false)).rejects.toBeInstanceOf(
      UserFacingError,
    );
    // The property that matters is this one, not the message: the RPC consumes
    // one of ten daily imports before it does any work.
    expect(calls).toHaveLength(0);
  });

  it("is checked before the rows are, so an un-ticked box is not reported as a bad file", async () => {
    const { client } = fakeClient({ data: SUMMARY });

    // Both wrong. The host has to be told about the checkbox they can fix, not
    // about a payload shape they cannot see.
    await expect(
      importEventAttendees(client, EVENT_ID, [row({ email: 42 })], false),
    ).rejects.toThrow(/allowed to contact these guests/i);
  });
});

describe("a list with nothing importable in it", () => {
  it("is refused rather than charged for", async () => {
    // Same argument as the attestation, one step further along: the RPC would
    // accept an empty array, loop over nothing, report four zeroes, and still
    // have spent one of the host's ten daily imports. A file whose status
    // column excluded every row is a real case, and it is a thing to tell the
    // host about rather than a thing to bill them for.
    const { client, calls } = fakeClient({ data: SUMMARY });

    await expect(importEventAttendees(client, EVENT_ID, [], true)).rejects.toThrow(
      /no guests to import/i,
    );
    expect(calls).toHaveLength(0);
  });

  it("says which two things to check, since the host cannot see why the list came out empty", async () => {
    const { client } = fakeClient({ data: SUMMARY });

    await expect(importEventAttendees(client, EVENT_ID, [], true)).rejects.toThrow(
      /email address.*status|status.*email address/i,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. What reaches the browser
// ---------------------------------------------------------------------------

/** Every refusal code the RPC can raise, with the phrase a host should see. */
const REFUSALS = [
  ["42501", /verified host/i],
  ["53400", /today's import limit/i],
  ["22023", /too big to import/i],
] as const;

describe("turning the database's refusals into sentences", () => {
  it.each(REFUSALS)("maps %s to a message written for a person", async (code, expected) => {
    const { client } = fakeClient({
      error: { code, message: 'permission denied for table "event_attendee_imports"' },
    });

    const failure = await importEventAttendees(client, EVENT_ID, [row()], true).catch(
      (e: unknown) => e,
    );

    expect(failure).toBeInstanceOf(UserFacingError);
    expect((failure as Error).message).toMatch(expected);
  });

  it("never lets the database's own words through on a mapped refusal", async () => {
    // The whole reason `@/server/errors` is opt-in: a PostgREST message names
    // tables, columns, constraints and policies, and failing an action on
    // purpose is easy because that is what a policy refusal IS.
    for (const [code] of REFUSALS) {
      const { client } = fakeClient({
        error: {
          code,
          message:
            'new row violates row-level security policy for table "event_attendee_imports"',
        },
      });

      const failure = await importEventAttendees(client, EVENT_ID, [row()], true).catch(
        (e: unknown) => e,
      );

      expect((failure as Error).message).not.toMatch(/event_attendee_imports|row-level|policy/i);
    }
  });

  it("does not say WHICH of the three things `42501` means", async () => {
    // The RPC answers identically for "not signed in", "not a verified host"
    // and "not the host of this event" so that a guessed event id cannot be
    // used to discover whether it exists or who runs it. A friendlier split
    // here would rebuild that probe one layer up.
    const { client } = fakeClient({ error: { code: "42501", message: "not authorized" } });

    const failure = await importEventAttendees(client, EVENT_ID, [row()], true).catch(
      (e: unknown) => e,
    );

    const message = (failure as Error).message;
    expect(message).toMatch(/verified host/i);
    // Nothing that would tell a caller the event is real, or that it is
    // somebody else's, or that their own verification is the part that failed.
    expect(message).not.toMatch(/does not exist|no such|belongs to|another host|not verified yet/i);
  });

  it("does not quote a limit it cannot read", async () => {
    // `app_config` is unreadable to `authenticated` by design, so any figure in
    // these messages would be a copy that goes stale the moment the real one is
    // raised — which is exactly what would happen on the night of a pilot event.
    for (const [code] of REFUSALS) {
      const { client } = fakeClient({ error: { code, message: "refused" } });
      const failure = await importEventAttendees(client, EVENT_ID, [row()], true).catch(
        (e: unknown) => e,
      );
      expect((failure as Error).message).not.toMatch(/\b(10|5000|5,000)\b/);
    }
  });

  it("does NOT dress an unrecognised code up as a user-facing message", async () => {
    // `55000` is "an app_config row is missing" — our bug, not the host's. It
    // has to stay a plain Error so `safeActionErrorMessage` collapses it to the
    // generic sentence and logs the real one server-side. A UserFacingError
    // here would put a configuration fault on somebody's screen.
    const { client } = fakeClient({
      error: { code: "55000", message: "import configuration missing" },
    });

    const failure = await importEventAttendees(client, EVENT_ID, [row()], true).catch(
      (e: unknown) => e,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(UserFacingError);
  });

  it("treats an error with no code the same way — unrecognised, not user-facing", async () => {
    const { client } = fakeClient({ error: { message: "connection terminated unexpectedly" } });

    await expect(importEventAttendees(client, EVENT_ID, [row()], true)).rejects.not.toBeInstanceOf(
      UserFacingError,
    );
  });
});

describe("an answer that is not the summary this code expects", () => {
  it.each([
    ["null", null],
    ["a number", 7],
    ["an object missing a count", { imported: 1, updated: 0, skipped_no_email: 0 }],
    [
      "a count that is not a number",
      { imported: "3", updated: 0, skipped_no_email: 0, skipped_already_claimed: 0 },
    ],
    [
      "a negative count",
      { imported: -1, updated: 0, skipped_no_email: 0, skipped_already_claimed: 0 },
    ],
  ])("throws on %s rather than rendering it", async (_label, data) => {
    // The alternative is a host reading "undefined guests imported", which
    // looks like a broken page rather than the contract change it would be.
    const { client } = fakeClient({ data });

    const failure = await importEventAttendees(client, EVENT_ID, [row()], true).catch(
      (e: unknown) => e,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(UserFacingError);
  });
});
