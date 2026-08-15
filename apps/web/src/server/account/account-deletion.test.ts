import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  AccountDeletionRefusedError,
  softDeleteOwnAccount,
} from "./account-service";

/**
 * SELF-SERVE ACCOUNT DELETION, TESTED AS THE TWO RULES IT HAS TO KEEP.
 *
 * RULE 1 — YOU CAN ONLY DELETE YOURSELF. Not "the service layer is careful to
 * pass the right id": there is no id. The RPC takes no arguments and reads the
 * subject from the JWT, so the class of bug where a destructive action is
 * pointed at the wrong person is not expressible. The service-layer tests below
 * assert that property from the outside, by checking what is actually sent.
 *
 * RULE 2 — IT IS ALL OR NOTHING. Revoking the cards, cancelling the events and
 * marking the account deleted happen in ONE transaction, because the partial
 * states are security-relevant: "account deleted, cards not revoked" leaves a
 * URL printed on a physical object still answering with the person's phone
 * number and email. That rule lives in `plpgsql`, and a Vitest run has no
 * database — so it is asserted the only way it honestly can be, by reading the
 * migration and checking that all four writes are inside one function body and
 * that nothing in the TypeScript is in a position to do them separately.
 *
 * WHY A SOURCE SCAN IS A LEGITIMATE TEST HERE AND NOT AN EXCUSE
 *
 * The same argument `no-second-write-path.test.ts` makes for the connect flow:
 * some properties are properties of the repository rather than of any one
 * execution, and the alternative to asserting them mechanically is trusting code
 * review to notice. It is a blunt instrument and it will fail on a legitimate
 * rewrite of the migration — the right response to that failure is to check that
 * the rewrite kept the four writes together, not to loosen the pattern.
 *
 * What this cannot do, stated so nobody mistakes a green run for more than it
 * is: it does not prove the SQL is correct, only that it says what it is
 * supposed to say. Those assertions become real the first time the migration is
 * applied, which is deliberately not part of this build.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..");
const MIGRATIONS = join(REPO_ROOT, "supabase", "migrations");

function migration(prefix: string): string {
  const name = readdirSync(MIGRATIONS).find((entry) => entry.startsWith(prefix));
  if (name === undefined) {
    throw new Error(`No migration starting ${prefix}. Did a timestamp change?`);
  }
  return readFileSync(join(MIGRATIONS, name), "utf8");
}

/**
 * The body of one `create or replace function`, comments stripped.
 *
 * Comments have to go: every migration in this repo carries more prose than
 * code, and every phrase these assertions look for ("cards", "revoked",
 * "cancelled") appears in the prose explaining the decision. A scan that
 * counted the explanation as the implementation would pass on a function whose
 * body had been emptied out.
 */
function functionBody(sql: string, signature: string): string {
  const start = sql.indexOf(signature);
  expect(start, `${signature} is not in the migration`).toBeGreaterThan(-1);

  const open = sql.indexOf("as $$", start);
  const close = sql.indexOf("\n$$;", open);
  expect(open, "no `as $$` after the signature").toBeGreaterThan(-1);
  expect(close, "no closing `$$;`").toBeGreaterThan(open);

  return sql
    .slice(open, close)
    .replace(/^\s*--[^\n]*$/gm, "")
    .replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// The service layer
// ---------------------------------------------------------------------------

interface RpcCall {
  fn: string;
  args: unknown;
}

function fakeClient(answer: { data?: unknown; error?: { message: string } }): {
  client: SupabaseClient;
  calls: RpcCall[];
} {
  const calls: RpcCall[] = [];
  const client = {
    async rpc(fn: string, args?: unknown) {
      calls.push({ fn, args });
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

const COMMITTED = {
  ok: true,
  already_deleted: false,
  cards_revoked: 2,
  events_cancelled: 1,
  sessions_revoked: 1,
};

describe("the deletion call cannot name anybody", () => {
  it("sends the RPC with no arguments at all", async () => {
    // THE test for rule 1. `soft_delete_own_account()` reads its subject from
    // `private.current_user_id()`, and this asserts the service layer never
    // starts passing one — the moment it does, somebody has added a uuid
    // parameter to a destructive function and the "you can only delete
    // yourself" property is now a property of this file's correctness instead
    // of the database's shape.
    const { client, calls } = fakeClient({ data: COMMITTED });
    await softDeleteOwnAccount(client);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.fn).toBe("soft_delete_own_account");
    expect(calls[0]?.args).toBeUndefined();
  });
});

describe("what the service layer does with each answer", () => {
  it("reports the counts of a committed deletion", async () => {
    const { client } = fakeClient({ data: COMMITTED });

    await expect(softDeleteOwnAccount(client)).resolves.toStrictEqual({
      alreadyDeleted: false,
      cardsRevoked: 2,
      eventsCancelled: 1,
      sessionsRevoked: 1,
    });
  });

  it("treats an already-deleted account as success, not as an error", async () => {
    // A double-submitted confirmation is the ordinary way here. The person's
    // intent is already satisfied and the next step — sign out — is the same,
    // so refusing would show an error for a state they asked for.
    const { client } = fakeClient({ data: { ok: true, already_deleted: true } });

    await expect(softDeleteOwnAccount(client)).resolves.toStrictEqual({
      alreadyDeleted: true,
      cardsRevoked: 0,
      eventsCancelled: 0,
      sessionsRevoked: 0,
    });
  });

  it("throws a distinguishable error for a refusal", async () => {
    const { client } = fakeClient({ data: { ok: false, reason: "account_not_active" } });

    await expect(softDeleteOwnAccount(client)).rejects.toBeInstanceOf(AccountDeletionRefusedError);
  });

  it("throws for a transport or database failure", async () => {
    const { client } = fakeClient({ error: { message: "connection reset" } });
    await expect(softDeleteOwnAccount(client)).rejects.toThrow(/connection reset/);
  });

  it("treats an answer it does not recognise as NOT deleted", async () => {
    // The direction matters more than the assertion. A response with no `ok` is
    // ambiguous, and the two ways to resolve it are "assume it worked" — which
    // signs somebody out and tells them their account is gone when it may be
    // untouched — and "assume it did not", which shows an error over an account
    // that is fine. Only the second is recoverable.
    for (const data of [null, {}, { ok: "yes" }, [], "done"]) {
      const { client } = fakeClient({ data });
      await expect(softDeleteOwnAccount(client)).rejects.toThrow(/does not recognise/);
    }
  });
});

// ---------------------------------------------------------------------------
// The transaction, read off the migration
// ---------------------------------------------------------------------------

describe("the delete is one transaction that revokes cards and cancels events", () => {
  const sql = migration("20260815130300_");
  const body = functionBody(sql, "create or replace function public.soft_delete_own_account()");

  it("marks the account deleted", () => {
    expect(body).toMatch(/update public\.users u set status = 'deleted'/);
    expect(body).toMatch(/deleted_at = v_now/);
  });

  it("REVOKES EVERY ASSIGNED CARD THE PERSON OWNS", () => {
    // The single most important line in the feature. A card that still resolves
    // after deletion answers `/card/<code>` with a phone number and an email
    // address, from a permanent URL printed on a physical object that other
    // people are holding — deleting your account without this is not deleting
    // your account.
    expect(body).toMatch(
      /update public\.cards c set status = 'revoked' where c\.owner_user_id = v_user and c\.status = 'assigned'/,
    );
  });

  it("cancels every scheduled event the person hosts, with the reason recorded", () => {
    expect(body).toMatch(/update public\.events e set status = 'cancelled'/);
    expect(body).toMatch(/cancelled_reason = 'host_account_deleted'/);
    // `scheduled` only: an event the host had already cancelled keeps its own
    // reason, which is what lets the restore be precise about what to undo.
    expect(body).toMatch(/where e\.host_user_id = v_user and e\.status = 'scheduled'/);
  });

  it("burns any live presentation session, so a QR on screen stops resolving", () => {
    expect(body).toMatch(
      /update public\.connection_sessions s set status = 'revoked' where s\.presenter_user_id = v_user and s\.status = 'active'/,
    );
  });

  it("does all four inside ONE function body, which is what makes it atomic", () => {
    // plpgsql runs in a single transaction by construction. The property being
    // asserted is that nobody has moved one of the writes out of it — four
    // PostgREST calls would be four transactions, and any one of them could be
    // the last that runs.
    for (const table of [
      "public.users",
      "public.cards",
      "public.events",
      "public.connection_sessions",
    ]) {
      expect(body, `${table} is written outside the atomic function`).toContain(table);
    }
  });

  it("does not touch connections, meetings or event_rsvps", () => {
    // Deliberate, and each for a different reason (20260815130300's header).
    // `connections` most of all: the `active -> removed` transition is one-way
    // at the database, so removing edges here would make the delete
    // irreversible in the one dimension a soft delete must not be.
    for (const table of [
      "public.connections",
      "public.meetings",
      "public.meeting_participants",
      "public.event_rsvps",
    ]) {
      expect(body, `${table} is written by the delete`).not.toContain(table);
    }
  });

  it("is definer-rights, parameterless, and search-path pinned", () => {
    const declaration = sql.slice(
      sql.indexOf("create or replace function public.soft_delete_own_account()"),
      sql.indexOf("as $$", sql.indexOf("create or replace function public.soft_delete_own_account()")),
    );
    expect(declaration).toContain("security definer");
    expect(declaration).toContain("set search_path = ''");
    // The empty parameter list IS the anti-impersonation property.
    expect(sql).toContain("create or replace function public.soft_delete_own_account()");
  });

  it("is callable by a signed-in member and by nobody else", () => {
    expect(sql).toMatch(
      /revoke all on function public\.soft_delete_own_account\(\) from public, anon;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.soft_delete_own_account\(\) to authenticated;/,
    );
  });
});

describe("the restore is real, which is what makes the delete soft", () => {
  const sql = migration("20260815130300_");
  const body = functionBody(sql, "create or replace function public.restore_deleted_user(");

  it("puts the account back", () => {
    expect(body).toMatch(/update public\.users u set status = 'active'/);
    expect(body).toMatch(/deleted_at = null/);
  });

  it("un-cancels ONLY the events this deletion cancelled", () => {
    // Without the reason filter a restore would resurrect an event the host had
    // deliberately called off. This is the whole justification for the
    // `cancelled_reason` column existing with one value in it.
    expect(body).toMatch(/e\.cancelled_reason = 'host_account_deleted'/);
  });

  it("does NOT re-arm the cards", () => {
    // `cards.status` records no reason, so the database cannot tell a card this
    // deletion revoked from one the owner revoked after losing it. Guessing
    // "re-enable everything" on a security kill switch is not an acceptable
    // trade for saving the owner a tap on /activity.
    expect(body).not.toMatch(/update public\.cards/);
    expect(body).toMatch(/select count\(\*\) into v_cards_left_revoked/);
  });

  it("is service-role only — there is no in-app path to resurrecting an account", () => {
    expect(sql).toMatch(
      /revoke all on function public\.restore_deleted_user\(uuid\) from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.restore_deleted_user\(uuid\) to service_role;/,
    );
  });
});

// ---------------------------------------------------------------------------
// The visibility rules the delete depends on
// ---------------------------------------------------------------------------

describe("a deleted person is hidden, and a cancelled event is not", () => {
  const rls = migration("20260815130200_");

  it("drops the connection and co-attendee branches for a deleted row", () => {
    const policy = rls.slice(
      rls.indexOf('create policy "read self, connections, and co-attendees only"'),
    );
    expect(policy).toMatch(/users\.status <> 'deleted'/);
    // Self stays readable whatever the status: a screen that has to tell
    // somebody something about their own deleted account must be able to.
    expect(policy).toMatch(/id = \(select private\.current_user_id\(\)\)/);
  });

  it("hides a cancelled event from browse while keeping it for everyone who answered", () => {
    const fn = functionBody(rls, "create or replace function private.can_see_event(");

    // The public branch is the only one narrowed. This pair of assertions is
    // the owner's rule stated twice: strangers stop seeing it, and the people
    // who were counting on it do not find it silently gone.
    expect(fn).toMatch(/e\.visibility = 'public' and e\.status <> 'cancelled'/);
    expect(fn).toMatch(/e\.host_user_id = viewer/);
    expect(fn).toMatch(/from public\.event_rsvps r where r\.event_id = e\.id and r\.user_id = viewer/);
    expect(fn).toMatch(
      /from public\.event_invites i where i\.event_id = e\.id and i\.invited_user_id = viewer/,
    );
  });

  it("closes a cancelled event's queue instead of rewriting the answers in it", () => {
    // Writing `denied` on the waiting rows would record a host decision that
    // never happened — 20260815130100's judgment call. The trigger refuses new
    // and changed answers; DELETE stays allowed so withdrawing still works.
    const schema = migration("20260815130100_");
    const trigger = functionBody(
      schema,
      "create or replace function private.refuse_rsvp_to_cancelled_event()",
    );
    expect(trigger).toMatch(/e\.status = 'cancelled'/);
    expect(trigger).toMatch(/raise exception/);
    expect(schema).toMatch(/before insert or update on public\.event_rsvps/);
    expect(schema).not.toMatch(/before insert or update or delete on public\.event_rsvps/);
  });
});

// ---------------------------------------------------------------------------
// The columns the client still may not write
// ---------------------------------------------------------------------------

describe("adding these columns did not widen anybody's grant", () => {
  it("no migration adds a status or lifecycle column to a client UPDATE grant", () => {
    // Column-level grants are explicit lists, so a new column is unwritable by
    // `authenticated` from the moment it exists — but only until somebody adds
    // it to the list. These four are the ones that decide what an account IS,
    // and every one of them is written exclusively by a function.
    const everyMigration = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(join(MIGRATIONS, name), "utf8"))
      .join("\n")
      .replace(/^\s*--[^\n]*$/gm, "");

    // `[^)]*` rather than a lazy `[\s\S]*?`: a column list never contains a
    // closing paren, and the lazy form happily spans from one migration's
    // `grant update (` to a different migration's `) on public.events`, which
    // reports every column in the repository as belonging to one table.
    const grants = [...everyMigration.matchAll(/grant update \(([^)]*)\) on public\.(\w+)/g)];
    expect(grants.length, "the grant scan found nothing to check").toBeGreaterThan(0);

    /**
     * Never grantable on any table. Each of these decides what an account or an
     * event IS, rather than what it says about itself, and each has exactly one
     * writer — a function.
     */
    const NEVER = ["has_completed_signup", "deleted_at", "cancelled_at", "cancelled_reason", "is_admin"];

    /**
     * `status` is a column name four tables share, and two of them grant it
     * deliberately, so the rule has to name tables rather than the word:
     *
     *   cards       an owner MAY set their own card's status — that is §4.5's
     *               kill switch, confined to assigned/revoked by the policy's
     *               WITH CHECK, and it is also what lets a restored member
     *               switch their cards back on for themselves.
     *   connections an owner MAY set `active -> removed`, confined by the same
     *               mechanism (20260809211200). There is no way back, on purpose.
     *   users       must never be grantable: it is the difference between
     *               active, suspended and deleted, and a client that could
     *               write it could un-suspend itself.
     *   events      must never be grantable: it is the cancellation, whose only
     *               writer is the deletion transaction.
     */
    const NO_STATUS_GRANT = ["users", "events"];

    for (const [, columnList, table] of grants) {
      // `noUncheckedIndexedAccess` types a capture group as possibly-undefined.
      // Both groups are non-optional in the pattern, so this is a type-level
      // formality rather than a real case — asserted rather than defaulted, so
      // a pattern edit that made them optional fails here instead of silently
      // checking an empty list.
      expect(columnList).toBeDefined();
      expect(table).toBeDefined();
      const columns = (columnList ?? "").split(",").map((column) => column.trim());

      for (const forbidden of NEVER) {
        expect(columns, `public.${table}'s UPDATE grant includes ${forbidden}`).not.toContain(
          forbidden,
        );
      }

      if (NO_STATUS_GRANT.includes(table as string)) {
        expect(columns, `public.${table}'s UPDATE grant includes status`).not.toContain("status");
      }
    }
  });
});
