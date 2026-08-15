import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * A photo must never outlive the visibility of the profile it belongs to.
 *
 * WHY THIS IS A SOURCE TEST RATHER THAN A BEHAVIOURAL ONE
 *
 * The rule lives in two RLS policies, and this environment's egress policy
 * blocks the project's Supabase host — the same restriction already recorded
 * against the §6.5 photo upload and the §6.6 spot-check — so the test runner
 * cannot ask the real database. The policies themselves were verified directly
 * against the live database by simulated session, before and after the change
 * (see `20260815010000`'s header): a stranger sees 0 of 148 objects, a
 * connection sees the one it should, and removing the connection revokes it.
 *
 * What that verification cannot do is stay true. This test guards the property
 * that made it true — that BOTH policies are expressed in terms of one shared
 * predicate — so a future migration cannot quietly give photos a second,
 * divergent rule.
 *
 * THE BUG THIS EXISTS TO PREVENT A REPEAT OF (2026-08-15 audit)
 *
 * `20260813191041` gave the `profile-photos` bucket ONE rule for all four
 * verbs: own `{user_id}/` prefix. Correct for the three writes, wrong for
 * reads, because the app renders other people's photos on `/feed`,
 * `/connections`, `/connections/[connectionId]` and `/activity`. Six of the
 * seven `signedProfilePhotoUrl` call sites pass a counterpart's path with the
 * viewer's own client, and Storage enforces RLS at signing time — so every one
 * of them silently returned null and rendered as fallback initials. Nobody had
 * seen it because `connections` still holds zero rows; the first real
 * connection of the pilot would have exposed it.
 *
 * The DANGEROUS repair would have been to widen the read rule to "any
 * authenticated user", which renders correctly and hands a photo to somebody
 * who cannot see the profile it belongs to — the "no public profile" rule in
 * CLAUDE.md defeated by a side door. So this test asserts the shape of the fix,
 * not merely that the fix changed something.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS = join(HERE, "..", "..", "..", "..", "..", "supabase", "migrations");

function migrationSql(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), "utf8") }));
}

/**
 * Replays the migration set in order and returns the policies actually IN
 * FORCE at the end of it — `create policy` adds, `drop policy` removes.
 *
 * Tracking drops is not pedantry, and the first version of this file got it
 * wrong: the legacy photo import created two TEMPORARY `anon` policies on this
 * same bucket (`20260813180402`, `20260814000100`) and later revoked them
 * (`20260813180755`, `20260814000200`). A reader that only looked at `create`
 * statements would report those as live and would have concluded this bucket
 * grants anonymous writes. A test that models the schema wrongly is worse than
 * no test, because it reports on a database that does not exist.
 */
function policiesInForce(): Map<string, string> {
  const live = new Map<string, string>();

  for (const { sql } of migrationSql()) {
    for (const match of sql.matchAll(/drop policy (?:if exists )?"([^"]+)"/g)) {
      const name = match[1];
      if (name !== undefined) live.delete(name);
    }
    for (const match of sql.matchAll(/create policy "([^"]+)"/g)) {
      const name = match[1];
      if (name === undefined) continue;
      const at = match.index ?? 0;
      const end = sql.indexOf(";", at);
      live.set(name, sql.slice(at, end === -1 ? undefined : end));
    }
  }
  return live;
}

/** The body of one policy still in force, or null if it is not. */
function latestPolicyBody(policyName: string): string | null {
  return policiesInForce().get(policyName) ?? null;
}

/** Every policy still in force that governs the `profile-photos` bucket. */
function profilePhotoPolicyNames(): string[] {
  return [...policiesInForce()]
    .filter(([, body]) => body.includes("storage.objects") && body.includes("'profile-photos'"))
    .map(([name]) => name);
}

describe("profile photos follow profile visibility", () => {
  it("gates reads on the shared can_see_user predicate", () => {
    const body = latestPolicyBody("read profile photos of people you can see");

    expect(body, "the profile-photos SELECT policy should exist").not.toBeNull();
    expect(body).toContain("private.can_see_user");
    expect(body).toContain("private.profile_photo_owner_id");
  });

  it("gates the users table on that same predicate, so the two cannot drift", () => {
    // This is the whole point. If a later change narrows profile visibility and
    // photos are governed by a separate copy of the rule, the photo stays
    // readable after the profile stops being — a leak nobody would notice,
    // because the symptom is an avatar that still renders.
    const body = latestPolicyBody("read self, connections, and co-attendees only");

    expect(body, "the users SELECT policy should exist").not.toBeNull();
    expect(body).toContain("private.can_see_user");
  });

  it("never lets a photo be readable by any signed-in user", () => {
    // The tempting wrong fix: it makes every avatar render, and hands a photo
    // to somebody who cannot see the profile it belongs to.
    const body = latestPolicyBody("read profile photos of people you can see") ?? "";
    const predicate = body.slice(body.indexOf("using"));

    expect(predicate).not.toMatch(/using\s*\(\s*true\s*\)/);
    // A bucket check alone, with nothing tying the object to a viewer, would be
    // "anyone signed in" written the long way.
    expect(predicate).toMatch(/can_see_user|auth\.uid\(\)/);
  });

  it("keeps every WRITE on profile photos scoped to the caller's own prefix", () => {
    // Reads widened; writes must not have. `foldername(name)[1] = auth.uid()`
    // is what stops one user overwriting or deleting another's photo, and it is
    // a different question from who may look at it.
    const writePolicies = profilePhotoPolicyNames()
      .map((name) => ({ name, body: latestPolicyBody(name) ?? "" }))
      .filter(({ body }) => /for\s+(insert|update|delete)/i.test(body));

    expect(writePolicies.length, "expected insert/update/delete policies").toBe(3);

    for (const { name, body } of writePolicies) {
      expect(body, `${name} must stay own-prefix only`).toContain("storage.foldername(name)");
      expect(body, `${name} must not use the read predicate`).not.toContain("can_see_user");
    }
  });

  it("derives the photo's owner from the path in a way a malformed key fails closed on", () => {
    // `profile_photo_owner_id` pattern-matches before casting so a junk key
    // returns NULL — which fails `can_see_user` — rather than raising 22P02
    // inside a policy. Same contract as `event_cover_event_id`.
    const fn = migrationSql()
      .map(({ sql }) => sql)
      .find((sql) => sql.includes("function private.profile_photo_owner_id"));

    expect(fn).toBeDefined();
    expect(fn).toContain("else null");
    expect(fn).toContain("set search_path = ''");
  });
});
