import { LoginLink, LogoutLink } from "@kinde-oss/kinde-auth-nextjs/components";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { MissingEnvVarError } from "@/server/env";

/**
 * The end-to-end proof that the Kinde -> Supabase bridge works. Not a product
 * screen — the Profile screen is the next phase's job, and this page should be
 * deleted or folded into a real test once that lands.
 *
 * WHY A PAGE AND NOT A UNIT TEST
 *
 * Every interesting failure in this bridge happens *between* components: a
 * token that verifies but carries the wrong `sub`, a `sub` the database refuses
 * to cast, a role claim that lands the caller on `anon` where no grant exists.
 * A test with a mocked Supabase client passes through all of those. This page
 * runs the real chain — real Kinde session, real signed token, real PostgREST
 * request, real policies — and every query below deliberately goes through the
 * RLS-bound client. Nothing here uses the service role, because a check that
 * bypasses the thing being checked proves nothing.
 *
 * WHAT IT VERIFIES, AND WHY THESE FOUR
 *
 * This is architecture §6.6's outstanding line — "spot-check RLS as a real
 * migrated user (can see own data, cannot see a stranger's)" — which has been
 * unrunnable since the data migration landed, because with `auth.uid()` empty
 * every policy denies everything and a passing "can't see a stranger" check
 * would have been indistinguishable from auth simply not existing. So the
 * checks are written in pairs: something must be *visible* and something must
 * be *denied*, in the same request. All-denied is a failure here, not a pass.
 */
export const dynamic = "force-dynamic";

interface CheckResult {
  label: string;
  expectation: string;
  outcome: string;
  passed: boolean;
}

export default async function AuthCheckPage() {
  let context;
  try {
    context = await getAuthenticatedContext();
  } catch (error) {
    return <Failure error={error} />;
  }

  if (context === null) {
    return (
      <Shell>
        <p className="text-zinc-700 dark:text-zinc-300">Not signed in.</p>
        {/* Kinde's own link components, so the OAuth start/end URLs come from the
            SDK's config rather than being hardcoded here and drifting from it. */}
        <LoginLink className="underline">Sign in with Kinde</LoginLink>
      </Shell>
    );
  }

  const { supabase, userId } = context;
  const checks: CheckResult[] = [];

  // 1. Can the signed-in user read their own row? This is the positive half of
  //    §6.6: it can only pass if `auth.uid()` resolved to this exact uuid,
  //    because the policy's only self branch is `id = private.current_user_id()`.
  const own = await supabase.from("users").select("id, email").eq("id", userId).maybeSingle();
  checks.push({
    label: "Read own users row through RLS",
    expectation: "exactly one row, matching the resolved users.id",
    outcome: own.error
      ? `error: ${own.error.message}`
      : own.data
        ? `ok — id matches: ${own.data.id === userId}`
        : "no row returned",
    passed: !own.error && own.data?.id === userId,
  });

  // 2. How many of the 337 rows are visible at all? One. Anything higher means
  //    the policy is wider than §3.4 intends; zero means auth did not resolve.
  const visible = await supabase.from("users").select("id", { count: "exact", head: true });
  checks.push({
    label: "Total users rows visible",
    expectation: "1 of 337 — no connections and no shared events exist yet",
    outcome: visible.error ? `error: ${visible.error.message}` : `${visible.count}`,
    passed: !visible.error && visible.count === 1,
  });

  // 3. The negative half: every *other* user in the database is invisible.
  //    Asking for "everyone who is not me" is the closest thing to the global
  //    search this product forbids, and the database is structurally unable to
  //    answer it (§3.4).
  const strangers = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .neq("id", userId);
  checks.push({
    label: "Read any other user's row",
    expectation: "0 — no global directory exists",
    outcome: strangers.error ? `error: ${strangers.error.message}` : `${strangers.count}`,
    passed: !strangers.error && strangers.count === 0,
  });

  // 4. A second table, to show the identity carries across policies rather than
  //    being a quirk of the `users` one. Cards are owner-only, and `card_code`
  //    is itself the security token (§2.2), so a stranger's card row must never
  //    come back.
  const ownCards = await supabase
    .from("cards")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", userId);
  const otherCards = await supabase
    .from("cards")
    .select("id", { count: "exact", head: true })
    .neq("owner_user_id", userId);
  checks.push({
    label: "Cards visible: own vs. everyone else's",
    expectation: "own may be any number; everyone else's must be 0 of 7,142",
    outcome: ownCards.error
      ? `error: ${ownCards.error.message}`
      : otherCards.error
        ? `error: ${otherCards.error.message}`
        : `own: ${ownCards.count}, others: ${otherCards.count}`,
    passed: !ownCards.error && !otherCards.error && otherCards.count === 0,
  });

  const allPassed = checks.every((check) => check.passed);

  return (
    <Shell>
      <p className="text-zinc-700 dark:text-zinc-300">
        Signed in. Resolved <code>public.users.id</code>: <code>{userId}</code>
      </p>
      <p className={allPassed ? "text-green-700" : "text-red-700"}>
        {allPassed ? "All RLS checks passed." : "At least one check FAILED — see below."}
      </p>
      <ul className="flex flex-col gap-3">
        {checks.map((check) => (
          <li key={check.label} className="border-l-2 border-zinc-300 pl-3 dark:border-zinc-700">
            <div className="font-medium">
              {check.passed ? "PASS" : "FAIL"} — {check.label}
            </div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              expected: {check.expectation}
            </div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">got: {check.outcome}</div>
          </li>
        ))}
      </ul>
      <LogoutLink className="underline">Sign out</LogoutLink>
    </Shell>
  );
}

/**
 * A missing secret is the expected failure while `SUPABASE_SERVICE_ROLE_KEY`
 * and `SUPABASE_JWT_SECRET` are still outstanding, so it gets a legible message
 * naming the variable rather than a stack trace. Everything else is re-thrown
 * shape-wise as a message: this page exists to diagnose, so swallowing detail
 * would defeat it.
 */
function Failure({ error }: { error: unknown }) {
  const isMissingEnv = error instanceof MissingEnvVarError;
  return (
    <Shell>
      <p className="text-red-700">{isMissingEnv ? "Configuration incomplete" : "Auth failed"}</p>
      <pre className="whitespace-pre-wrap text-sm">
        {error instanceof Error ? error.message : String(error)}
      </pre>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-8 font-mono text-zinc-900 dark:text-zinc-100">
      <h1 className="text-xl font-semibold">Auth bridge check</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Kinde session &rarr; verified token &rarr; <code>public.users</code> row &rarr; minted
        Supabase JWT &rarr; RLS-protected query. Temporary; architecture &sect;5.4 / &sect;6.6.
      </p>
      {children}
    </main>
  );
}
