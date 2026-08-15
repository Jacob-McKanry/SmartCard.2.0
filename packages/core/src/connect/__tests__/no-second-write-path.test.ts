import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * §4.7 threat 4's instruction, enforced against the source tree rather than
 * trusted to code review:
 *
 *   "`createVerifiedConnection` is the only writer to `connections`. Protect by
 *    never adding a user-search/list endpoint and never adding a second path
 *    that writes connections."
 *
 * A behavioural test cannot show this — the absence of a second write path is a
 * property of the whole repository, not of any one execution. So this test
 * reads the source and asserts the property directly. It is deliberately a
 * blunt instrument: it will fail loudly on a legitimate refactor, and the right
 * response to that failure is to think about whether the refactor introduced a
 * second writer, not to loosen the pattern.
 *
 * The database enforces the same thing independently and more strongly — no
 * INSERT policy and no INSERT grant on `connections`, `meetings`,
 * `meeting_participants`, `meeting_locations` or `connection_sessions` for any
 * client role (20260809211200), verified against the live database by simulated
 * session. This test guards the service-role side, which RLS by definition
 * cannot.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..");

const SEARCH_ROOTS = [
  join(REPO_ROOT, "packages", "core", "src"),
  join(REPO_ROOT, "packages", "types", "src"),
  join(REPO_ROOT, "packages", "api-client", "src"),
  join(REPO_ROOT, "apps", "web", "src"),
];

/** The graph tables no code outside the atomic commit may write. */
const PROTECTED_TABLES = ["connections", "meetings", "meeting_participants", "meeting_locations"];

/**
 * The only files allowed to reference the atomic commit, and the only file
 * allowed to name `connection_sessions` in a write.
 *
 * `supabase-connect-store.ts` is the ConnectStore implementation — it calls the
 * RPC and manages sessions. Test files are allowed because a fake store has to
 * model the thing it fakes.
 */
const ALLOWED_COMMIT_CALLERS = [
  join("apps", "web", "src", "server", "connect", "supabase-connect-store.ts"),
];

/**
 * Files allowed an `.update(` (never `.insert`/`.upsert`) against a protected
 * table, and exactly which of the four tables each is allowed to touch that
 * way. `meeting_locations` has no entry anywhere — nothing legitimately
 * mutates a location after the atomic commit writes it.
 *
 * This exists because §4.7 threat 4 is about a SECOND CREATOR of graph rows —
 * `insert`/`upsert` stays checked with zero exceptions for every file, below.
 * An `.update()` to a column a migration's RLS grant already scopes narrowly
 * (never the row's existence, never who it connects) is a different thing:
 * `20260809211200_rls_policies_graph_and_meetings.sql` grants exactly
 * `update (is_private, location_visibility) on meetings`,
 * `update (location_share_consent, marked_private) on meeting_participants`,
 * and the one `active -> removed` transition on `connections` — and
 * `connections-service.ts` (see its own "Mutations" section header) uses
 * each of those and nothing else. RLS enforces the real boundary regardless
 * of this list; this list is what keeps the list itself honest as new
 * `.update()` calls are added, by making each one an explicit, reviewed line
 * here rather than a silent pass through a pattern that can't distinguish
 * "narrow grant-backed mutation" from "second creator".
 */
const ALLOWED_NARROW_UPDATERS: Record<string, string[]> = {
  connections: [join("apps", "web", "src", "server", "connections", "connections-service.ts")],
  meetings: [join("apps", "web", "src", "server", "connections", "connections-service.ts")],
  meeting_participants: [
    join("apps", "web", "src", "server", "connections", "connections-service.ts"),
  ],
  meeting_locations: [
    // Q25's reverse-geocoding job. Unlike every other entry in this map, this
    // one is NOT RLS-scoped: `meeting_locations` has no UPDATE policy for any
    // client role at all, so this file runs with the service role and RLS
    // provides no backstop — the only thing keeping the write narrow is the
    // code itself only ever setting `place_label`. See its own header.
    join("apps", "web", "src", "server", "connect", "geocode.ts"),
  ],
};

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".next") continue;
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

function sourceFiles(): { path: string; relative: string; text: string }[] {
  const files: { path: string; relative: string; text: string }[] = [];
  for (const root of SEARCH_ROOTS) {
    for (const path of walk(root)) {
      files.push({
        path,
        relative: path.slice(REPO_ROOT.length + 1),
        text: readFileSync(path, "utf8"),
      });
    }
  }
  return files;
}

/**
 * Strips block and line comments. Used only by the `has_completed_signup`
 * assertion below — see the note there for why that one scan is about code
 * rather than about text.
 *
 * `//` is only treated as a comment when it does not follow a colon or a word
 * character, so a `https://` inside a string does not swallow its line. Same
 * helper, same reasoning, as `settings-honesty.test.tsx`.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\w])\/\/[^\n]*/g, "$1");
}

const isTestFile = (relative: string) =>
  relative.includes("__tests__") || relative.endsWith(".test.ts");

describe("there is exactly one path that writes the social graph", () => {
  const files = sourceFiles();

  it("finds source files to inspect at all (guards against a silently empty scan)", () => {
    // Without this, a wrong REPO_ROOT would make every assertion below pass by
    // examining nothing — the classic way a source-scanning test becomes a
    // no-op nobody notices.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.relative.endsWith("create-verified-connection.ts"))).toBe(true);
  });

  it.each(PROTECTED_TABLES)("no code creates rows in `%s` through supabase-js", (table) => {
    // Matches `.from("connections")` followed by `.insert(` or `.upsert(`
    // within a short window — the shape every supabase-js row-creating write
    // takes. This is the actual §4.7 threat 4 concern (a second creator of
    // graph rows) and has zero exceptions, unlike the `.update()` check below.
    const pattern = new RegExp(
      String.raw`\.from\(\s*["'\`]${table}["'\`]\s*\)[\s\S]{0,200}?\.(insert|upsert)\(`,
    );
    const offenders = files
      .filter((file) => !isTestFile(file.relative))
      .filter((file) => pattern.test(file.text))
      .map((file) => file.relative);

    expect(
      offenders,
      `${offenders.join(", ")} creates rows in ${table} outside create_verified_connection. ` +
        `§4.7 threat 4: never add a second path that writes connections.`,
    ).toEqual([]);
  });

  it.each(PROTECTED_TABLES)("only an allowlisted file updates `%s`, and RLS still scopes it", (table) => {
    const pattern = new RegExp(
      String.raw`\.from\(\s*["'\`]${table}["'\`]\s*\)[\s\S]{0,200}?\.update\(`,
    );
    const updaters = files
      .filter((file) => !isTestFile(file.relative))
      .filter((file) => pattern.test(file.text))
      .map((file) => file.relative);

    expect(
      updaters.sort(),
      `${updaters.join(", ")} updates ${table} without being on ALLOWED_NARROW_UPDATERS. ` +
        `Either this is the file's known narrow, RLS-scoped mutation (add it to the list once ` +
        `you've checked it against the migration's grant) or it's a new writer that needs the ` +
        `same scrutiny §4.7 threat 4 gives inserts.`,
    // `?? []` because `noUncheckedIndexedAccess` (tsconfig.base.json) types an
    // index into a Record as possibly-undefined. The fallback is the strict
    // reading, not a convenience: a table missing from the allowlist means
    // NOTHING may update it, so an unlisted table asserts an empty set and any
    // updater at all fails the test. Defaulting the other way — skipping the
    // assertion — would make a typo in a table name silently disable the check.
    ).toEqual([...(ALLOWED_NARROW_UPDATERS[table] ?? [])].sort());
  });

  it("only the ConnectStore implementation calls the atomic commit RPC", () => {
    const callers = files
      .filter((file) => !isTestFile(file.relative))
      .filter((file) => /rpc\(\s*["'`]create_verified_connection["'`]/.test(file.text))
      .map((file) => file.relative);

    expect(callers.sort()).toEqual(ALLOWED_COMMIT_CALLERS.sort());
  });

  it("only the ConnectStore implementation writes connection_sessions", () => {
    const pattern =
      /\.from\(\s*["'`]connection_sessions["'`]\s*\)[\s\S]{0,200}?\.(insert|upsert|update)\(/;
    const writers = files
      .filter((file) => !isTestFile(file.relative))
      .filter((file) => pattern.test(file.text))
      .map((file) => file.relative);

    expect(writers.sort()).toEqual(ALLOWED_COMMIT_CALLERS.sort());
  });

  it("nothing outside the ConnectStore and ensureUser reaches for the service-role client", () => {
    // The service role is the absence of RLS. Every new importer of it is a new
    // place where a bug leaks a row instead of failing to find one, so the list
    // is asserted rather than reviewed.
    const importers = files
      .filter((file) => !isTestFile(file.relative))
      .filter(
        (file) =>
          /serviceRoleClient/.test(file.text) &&
          !file.relative.endsWith(join("supabase", "service-role-client.ts")),
      )
      .map((file) => file.relative)
      .sort();

    expect(importers).toEqual(
      [
        join("apps", "web", "src", "server", "auth", "ensure-user.ts"),
        join("apps", "web", "src", "server", "connect", "connect-service.ts"),
        join("apps", "web", "src", "server", "connect", "geocode.ts"),
        join("apps", "web", "src", "server", "connect", "push.ts"),
        join("apps", "web", "src", "server", "connect", "supabase-connect-store.ts"),
        // Added 2026-08-15 with the non-user card preview, by hand and with the
        // reasoning written down — which is the entire point of this assertion
        // being a list rather than a pattern.
        //
        // This importer is different in kind from the five above it, and the
        // difference is why it needed a decision rather than a line. Every
        // other one holds the service role to do something a signed-in caller's
        // own RLS-bound client cannot: create the row that establishes an
        // identity, write the graph through the atomic RPC, touch the
        // service-role-only audit and config tables. This one holds it because
        // THERE IS NO CALLER IDENTITY AT ALL — the reader is a visitor with no
        // account, so there is no `auth.uid()` for any policy in this schema to
        // be written against. The only alternative was a `users` policy whose
        // USING clause is true for `anon`, which would open the table
        // 20260809211100 calls "the most important policy file in the project"
        // to the entire internet and leave the narrowing to whatever `select()`
        // list the application happened to send.
        //
        // What keeps it honest is that the file is narrow and says so at
        // length: two entry points, each taking only a credential (a card code
        // or a signed QR token), a hardcoded column list, no caller-supplied
        // filter of any kind, and `social_links` never read.
        join("apps", "web", "src", "server", "cards", "card-preview-service.ts"),
        // Added 2026-08-15 with onboarding, by hand and with the reasoning
        // written down, exactly as the entry above it was.
        //
        // This importer writes ONE BOOLEAN on the caller's own row:
        // `users.has_completed_signup`. It holds the service role for a reason
        // that is the inverse of the card preview's — there, no policy could
        // serve the READER because there is no reader identity; here, no policy
        // may serve the WRITER because the writer is deliberately forbidden.
        // 20260809211100 keeps that column out of the column-level UPDATE grant
        // on `users` precisely so that "the server asserts onboarding finished,
        // not the client claiming it did", and a `security definer` RPC granted
        // to `authenticated` would have been the client claiming it, spelled as
        // a function call: it would take no evidence and weigh nothing.
        //
        // What keeps it honest: one statement, one column, one boolean, filtered
        // by an id its caller took from `getAuthenticatedContext()` rather than
        // from any request field. It reads nothing with this client. The profile
        // fields collected in the same flow are written by the ordinary
        // RLS-bound path (`updateOwnProfile`), not by this one.
        join("apps", "web", "src", "server", "onboarding", "onboarding-service.ts"),
      ].sort(),
    );
  });

  /**
   * The same rule as the assertion above, checked from the column's side instead
   * of the client's.
   *
   * `has_completed_signup` gates a wizard, so getting it wrong is not a
   * disclosure — but the reason it has no client write path is a decision
   * recorded in two migrations and an architecture amendment, and a decision
   * recorded three times and enforced nowhere is how a column quietly becomes
   * writable. The mistake this catches is the tempting one: a future onboarding
   * tweak adding the field to `userProfileUpdateSchema`, or writing it through
   * `context.supabase` because that is what every other profile write does.
   * Either would fail at the database with a permission error, and the natural
   * next move when it failed would be to widen the grant.
   */
  it("only the onboarding service names `has_completed_signup` in code", () => {
    // Comments are stripped for this one assertion, unlike everywhere else in
    // this file, and that is the point rather than a loophole: `ensure-user.ts`
    // names the column in the paragraph explaining why a fresh row deliberately
    // does NOT claim it, and a rule that forbade explaining the decision would
    // be a rule against writing the decision down.
    const writers = files
      .filter((file) => !isTestFile(file.relative))
      .filter((file) => /has_completed_signup/.test(withoutComments(file.text)))
      .map((file) => file.relative)
      .sort();

    expect(
      writers,
      `${writers.join(", ")} names has_completed_signup. That column is deliberately outside the ` +
        `column-level UPDATE grant on users (20260809211100), so the only code allowed to touch ` +
        `it is the service-role writer, and the only other code allowed to name it is the type ` +
        `describing the row.`,
    ).toEqual(
      [
        join("apps", "web", "src", "server", "onboarding", "onboarding-service.ts"),
        // The row shape. Naming a column in a Zod schema is not writing it, and
        // `userProfileUpdateSchema` in the same file deliberately omits it.
        join("packages", "types", "src", "db", "users.ts"),
      ].sort(),
    );
  });

  /**
   * Account deletion writes four tables. This asserts it does so from exactly
   * one place, and that the place is not TypeScript.
   *
   * The failure mode is specific and it is the one 20260815130300's header
   * spends its first page on: four sequential PostgREST calls are four
   * transactions, and the partial state "account marked deleted, cards not
   * revoked" leaves a printed URL on a physical object still answering with the
   * person's phone number. Someone refactoring the service layer for clarity —
   * inlining the RPC into the action, say, or "simplifying" it into two
   * `.update()` calls — would produce exactly that, and nothing else in the
   * codebase would complain.
   */
  it("only the account service calls the atomic account-deletion RPC", () => {
    const callers = files
      .filter((file) => !isTestFile(file.relative))
      .filter((file) => /rpc\(\s*["'`]soft_delete_own_account["'`]/.test(file.text))
      .map((file) => file.relative)
      .sort();

    expect(callers).toEqual([join("apps", "web", "src", "server", "account", "account-service.ts")]);
  });

  it("nothing in the app writes users.status or events.status directly", () => {
    // Both columns are outside their tables' column-level UPDATE grants, so a
    // direct write would fail — but it would fail at runtime, in the middle of a
    // destructive action, on a path where a partial result is the thing being
    // guarded against. The single writer of both is
    // `public.soft_delete_own_account()`, inside one transaction.
    const pattern =
      /\.from\(\s*["'`](users|events)["'`]\s*\)[\s\S]{0,200}?\.update\([\s\S]{0,200}?status:/;
    const offenders = files
      .filter((file) => !isTestFile(file.relative))
      .filter((file) => pattern.test(file.text))
      .map((file) => file.relative);

    expect(
      offenders,
      `${offenders.join(", ")} sets a status column on users or events through supabase-js. ` +
        `Both are written only by public.soft_delete_own_account(), which does it in one ` +
        `transaction alongside the card revocation — see 20260815130300.`,
    ).toEqual([]);
  });

  it("`sealVerified` is called from exactly the two verifiers and nowhere else", () => {
    // The one function that can mint the branded outcome `createVerifiedConnection`
    // accepts. A third call site means something other than a verification method
    // is producing proof that a verification happened.
    // Line-based rather than whole-file, so that the prose in `verification.ts`
    // and `index.ts` explaining WHY this function is hidden does not count as a
    // call site. A comment naming the mechanism is the opposite of a violation.
    const isCallSite = (line: string): boolean => {
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
        return false;
      }
      if (/export function sealVerified/.test(trimmed)) return false; // the definition
      if (/^import\b/.test(trimmed)) return false; // importing is not calling
      return /\bsealVerified\s*\(/.test(trimmed);
    };

    const callers = files
      .filter((file) => !isTestFile(file.relative))
      .filter((file) => file.text.split("\n").some(isCallSite))
      .map((file) => file.relative)
      .sort();

    expect(callers).toEqual(
      [
        join("packages", "core", "src", "connect", "nfc-verifier.ts"),
        join("packages", "core", "src", "connect", "qr-verifier.ts"),
      ].sort(),
    );
  });

  it("the package index does not re-export the sealing function", () => {
    const index = files.find(
      (file) => file.relative === join("packages", "core", "src", "index.ts"),
    );
    expect(index).toBeDefined();
    expect(index!.text).not.toMatch(/export\s*\{[^}]*sealVerified/);
  });
});

describe("the non-negotiable product rule, checked against the source", () => {
  const files = sourceFiles().filter((file) => !isTestFile(file.relative));

  it.each(["users", "social_links"])(
    "no code path lists or searches `%s` without a graph constraint",
    (table) => {
      // CLAUDE.md: "Never add a global user search, a stranger directory, or any
      // 'connect' action reachable from a shareable profile URL." The database
      // already refuses to answer the question (§3.4), but a service-role query
      // would bypass that — and the connect flow is the first feature in the
      // product that holds the service role.
      //
      // `social_links` was added to this scan 2026-08-15, when the card preview
      // started reading it with the service role. 20260809211100's objection to
      // exposing that table was to a "searchable directory of people's
      // off-platform handles", and its amendment permits the preview precisely
      // because the preview cannot search: it resolves a person from a
      // credential and asks for that one person's links by uuid. This is what
      // makes that argument checkable rather than merely asserted — the moment
      // any code can take a handle, a platform or a fragment and find rows, the
      // amendment's reasoning stops holding and this test says so.
      const pattern = new RegExp(
        String.raw`\.from\(\s*["'\`]${table}["'\`]\s*\)[\s\S]{0,160}?\.(ilike|like|textSearch|or)\(`,
      );
      const offenders = files.filter((file) => pattern.test(file.text)).map((f) => f.relative);
      expect(offenders).toEqual([]);
    },
  );

  it("the card preview never selects a wildcard column list", () => {
    // The module's whole claim is that its disclosed field lists are literals a
    // reviewer reads (`PREVIEW_COLUMNS`, `PREVIEW_SOCIAL_LINK_COLUMNS`), so that
    // a column added to `users` or `social_links` next year cannot appear on an
    // anonymous page without somebody deciding it should. A `select("*")`
    // anywhere in it silently reverses that, and it is one character away from
    // a legitimate edit.
    const preview = files.find((file) =>
      file.relative.endsWith(join("server", "cards", "card-preview-service.ts")),
    );
    expect(preview, "card-preview-service.ts was not found by the scan").toBeDefined();
    expect(preview!.text).not.toMatch(/\.select\(\s*["'`][^"'`]*\*/);
  });
});
