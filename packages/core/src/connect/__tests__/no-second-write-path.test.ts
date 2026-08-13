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

  it.each(PROTECTED_TABLES)("no code inserts into or updates `%s` through supabase-js", (table) => {
    // Matches `.from("connections")` followed by `.insert(`, `.upsert(` or
    // `.update(` within a short window — the shape every supabase-js write
    // takes.
    const pattern = new RegExp(
      String.raw`\.from\(\s*["'\`]${table}["'\`]\s*\)[\s\S]{0,200}?\.(insert|upsert|update)\(`,
    );
    const offenders = files
      .filter((file) => !isTestFile(file.relative))
      .filter((file) => pattern.test(file.text))
      .map((file) => file.relative);

    expect(
      offenders,
      `${offenders.join(", ")} writes ${table} outside create_verified_connection. ` +
        `§4.7 threat 4: never add a second path that writes connections.`,
    ).toEqual([]);
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
        join("apps", "web", "src", "server", "connect", "push.ts"),
        join("apps", "web", "src", "server", "connect", "supabase-connect-store.ts"),
      ].sort(),
    );
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

  it("no code path lists or searches users without a graph constraint", () => {
    // CLAUDE.md: "Never add a global user search, a stranger directory, or any
    // 'connect' action reachable from a shareable profile URL." The database
    // already refuses to answer the question (§3.4), but a service-role query
    // would bypass that — and the connect flow is the first feature in the
    // product that holds the service role.
    const pattern = /\.from\(\s*["'`]users["'`]\s*\)[\s\S]{0,160}?\.(ilike|like|textSearch|or)\(/;
    const offenders = files.filter((file) => pattern.test(file.text)).map((f) => f.relative);
    expect(offenders).toEqual([]);
  });
});
