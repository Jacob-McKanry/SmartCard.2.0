import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { userProfileUpdateSchema } from "@smartcard/types";

/**
 * ONBOARDING, TESTED AS THE TWO THINGS THAT WOULD BE BAD IF THEY BROKE.
 *
 * RULE 1 — THE COMPLETION FLAG IS NOT A CLIENT'S TO SET. `has_completed_signup`
 * is outside the column-level UPDATE grant on `users` (20260809211100) and
 * outside `userProfileUpdateSchema`, which mirrors that grant one-for-one. Both
 * exclusions are deliberate and both are asserted here, because the reason for
 * them lives in prose in three separate files and prose does not fail a build.
 * The companion assertion — that only one module in the repository writes the
 * column, with the service role — is in
 * `packages/core/src/connect/__tests__/no-second-write-path.test.ts`, next to
 * the service-role importer list it belongs with.
 *
 * RULE 2 — NOBODY GETS TRAPPED IN THE FLOW. The gate in `(app)/layout.tsx` is
 * unconditional: anybody whose flag is false is sent to `/onboarding` on every
 * signed-in navigation. Every field the flow collects is optional, so if there
 * were a way to reach the end without the flag being written, the person would
 * be returned to setup forever with nothing they could type to escape. The
 * "Skip for now" path is therefore load-bearing rather than a courtesy, and it
 * is asserted as such.
 *
 * These are source-level assertions for the reason `no-second-write-path.test.ts`
 * gives: "no client can write this column" and "the gate has an exit" are
 * properties of the repository rather than of any one execution, and the
 * alternative to checking them mechanically is trusting review to notice.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..");
const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..");
const MIGRATIONS = join(REPO_ROOT, "supabase", "migrations");

function migration(prefix: string): string {
  const name = readdirSync(MIGRATIONS).find((entry) => entry.startsWith(prefix));
  if (name === undefined) {
    throw new Error(`No migration starting ${prefix}. Did a timestamp change?`);
  }
  return readFileSync(join(MIGRATIONS, name), "utf8");
}

const read = (relative: string) => readFileSync(join(WEB_SRC, relative), "utf8");

// ---------------------------------------------------------------------------
// Rule 1 — the flag is asserted by the server, never claimed by the client
// ---------------------------------------------------------------------------

describe("a client cannot set has_completed_signup", () => {
  it("is dropped by the schema every profile write goes through", () => {
    // `userProfileUpdateSchema` is the exact column-level UPDATE grant, and Zod
    // strips unknown keys — so a client that posts the flag has it removed
    // before a query is even built. That is the first of three independent
    // stops; the grant is the second and the absence of any RPC is the third.
    const parsed = userProfileUpdateSchema.parse({
      first_name: "Sam",
      has_completed_signup: true,
      is_admin: true,
      status: "active",
    });

    expect(parsed).not.toHaveProperty("has_completed_signup");
    expect(parsed).not.toHaveProperty("is_admin");
    expect(parsed).not.toHaveProperty("status");
    expect(parsed.first_name).toBe("Sam");
  });

  it("is absent from the users UPDATE grant, which is the stop that actually holds", () => {
    // The schema above is convenience; this is the boundary. A client talking
    // to PostgREST directly with a valid token bypasses every line of
    // TypeScript in this repo and still cannot write this column.
    const sql = migration("20260809211100_");
    const grant = sql.slice(
      sql.indexOf("grant update ("),
      sql.indexOf(") on public.users to authenticated;"),
    );

    expect(grant).not.toContain("has_completed_signup");
    expect(grant).not.toContain("is_admin");
    expect(grant).not.toContain("status");
  });

  it("has no RPC handing the column to `authenticated` by another name", () => {
    // The alternative design, and the reason it was rejected: a `security
    // definer` function granted to `authenticated` that takes no evidence and
    // writes `true` IS the client claiming completion, spelled as a function
    // call. If one is ever added, the grant below is how it would have to be
    // reachable — so its absence is the assertion.
    const everyMigration = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(join(MIGRATIONS, name), "utf8"))
      .join("\n")
      .replace(/^\s*--[^\n]*$/gm, "");

    expect(everyMigration).not.toMatch(/complete_signup|finish_onboarding|mark_signup/i);
  });

  it("the backfill marks existing rows done and widens nothing", () => {
    const sql = migration("20260815130000_");

    // Every row that existed, so only accounts created after this ever see the
    // flow — the owner's decision, and the thing that keeps a mid-pilot member
    // from being ambushed by a setup wizard for an account they already have.
    expect(sql).toMatch(/update public\.users\s+set has_completed_signup = true/);
    // Idempotent: a second run updates nothing.
    expect(sql).toMatch(/where has_completed_signup = false;/);
    // And it is a data migration only — one UPDATE and one column comment. A
    // `grant` statement in this file would be the quiet way the column becomes
    // writable. Anchored to the start of a line so the column comment, which
    // explains at length which grant this column is absent from, does not
    // count as one.
    expect(sql.replace(/^\s*--[^\n]*$/gm, "")).not.toMatch(/^\s*grant\b/im);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — the gate has an exit
// ---------------------------------------------------------------------------

describe("nobody can be trapped in onboarding", () => {
  it("the flow is reachable and lives outside the gated route group", () => {
    // If `/onboarding` were inside `(app)`, the gate in that group's layout
    // would redirect the page to itself forever — a layout is never told the
    // pathname, so it could not exempt it. The file's location IS the fix.
    expect(existsSync(join(WEB_SRC, "app/onboarding/page.tsx"))).toBe(true);
    expect(existsSync(join(WEB_SRC, "app/(app)/onboarding/page.tsx"))).toBe(false);
  });

  it("the gate sends an unfinished account to the flow", () => {
    const layout = read("app/(app)/layout.tsx");

    expect(layout).toContain("hasCompletedSignup");
    expect(layout).toMatch(/redirect\("\/onboarding"\)/);
  });

  it("the flow offers a skip, and skipping records completion", () => {
    // The load-bearing one. Remove `assertSignupCompleted` from the skip path
    // and the button becomes a link back to the screen it is trying to leave.
    const actions = read("app/onboarding/actions.ts");
    const skip = actions.slice(actions.indexOf("export async function skipOnboardingAction"));

    expect(skip).toContain("assertSignupCompleted");
    expect(read("app/onboarding/onboarding-flow.tsx")).toContain("skipOnboardingAction");
  });

  it("finishing with the form records completion too, after the profile write", () => {
    // Order matters: profile first, flag second. The other order marks somebody
    // finished and then loses what they typed, with the gate now refusing to
    // bring them back to the form that had it.
    const actions = read("app/onboarding/actions.ts");
    const complete = actions.slice(
      actions.indexOf("export async function completeOnboardingAction"),
      actions.indexOf("export async function skipOnboardingAction"),
    );

    expect(complete).toContain("updateOwnProfile");
    expect(complete).toContain("assertSignupCompleted");
    expect(complete.indexOf("updateOwnProfile")).toBeLessThan(
      complete.indexOf("assertSignupCompleted"),
    );
  });

  it("the flow collects nothing the shipped profile write cannot store", () => {
    // The architecture amendment beside the column was explicit that the
    // designed screens "collect nothing the shipped profile actions and photo
    // uploader cannot already write", and that is what kept this a UI task
    // rather than a schema one. Every field name posted by the form has to be a
    // key of `userProfileUpdateSchema` — anything else would need a new grant.
    const allowed = new Set(Object.keys(userProfileUpdateSchema.shape));
    const actions = read("app/onboarding/actions.ts");
    const fields = [...actions.matchAll(/formData, "(\w+)"\)/g)].map((match) => match[1]);
    const checkbox = [...actions.matchAll(/formData\.get\("(\w+)"\)/g)].map((match) => match[1]);

    expect(fields.length).toBeGreaterThan(0);
    for (const field of [...fields, ...checkbox]) {
      expect(allowed, `onboarding posts "${field}", which is not in the users UPDATE grant`).toContain(
        field,
      );
    }
  });
});
