import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { serviceRoleClient } from "@/server/supabase/service-role-client";

/**
 * The two halves of `users.has_completed_signup`: reading it as the caller, and
 * asserting it as the server.
 *
 * ============================================================================
 * WHY THIS COLUMN HAD NO WRITER FOR A WEEK, AND WHY THAT WAS ALMOST RIGHT
 * ============================================================================
 *
 * `has_completed_signup` has existed since 20260809210100 and, until this
 * module, nothing in the codebase had ever written it. That was not an
 * oversight; it was two correct decisions with a gap between them, recorded as
 * an amendment beside the column in
 * `docs/architecture/2026-08-09-initial-architecture-proposal.md` §2.1:
 *
 *   * `ensureUser()` leaves it false on a new row, because "onboarding is a
 *     thing the server observes finishing, not a thing a fresh row claims".
 *   * `20260809211100` leaves it out of the column-level UPDATE grant on
 *     `users`, because "the server asserts onboarding finished, not the client
 *     claiming it did".
 *
 * Both still stand. Neither was changed to make onboarding work. What was
 * missing was the third thing: a server path entitled to assert it.
 *
 * ============================================================================
 * WHY A SERVICE-ROLE WRITE AND NOT A `security definer` RPC
 * ============================================================================
 *
 * The obvious alternative was the pattern the RSVP write path uses
 * (20260814051200): a `security definer` function in `public`, taking no
 * arguments, deriving the caller from the JWT, granted `execute` to
 * `authenticated`. It is a good pattern and it is the right one for
 * `soft_delete_own_account()` in the same feature. It is the wrong one here,
 * for a reason specific to what this column means.
 *
 * Those RPCs are safe to hand to a client because the client's request is an
 * INPUT to a computation the database performs — you ask to be `going`, and the
 * database decides whether that is `going`, `pending` or `waitlist` from facts
 * you do not control. There is no equivalent computation for this flag. An RPC
 * called `complete_signup()` would take no evidence, weigh nothing, and write
 * `true`. Granting execute on it to `authenticated` would mean any client can
 * set the column at any time — which is precisely "the client claiming
 * onboarding finished", spelled as a function call rather than as an UPDATE.
 * The migration's sentence would then be false while its grant list still said
 * it was true, which is the worst of both.
 *
 * So the writer is here, in server code, using the service role, and there is
 * no path from a browser to this column at all: no grant, no policy, no RPC.
 * The architecture amendment named this as the obvious candidate for exactly
 * this reason, and this is that.
 *
 * WHAT THIS DOES AND DOES NOT BUY, STATED HONESTLY. A Server Action is a POST
 * endpoint anyone with a session can call directly (see the security note in
 * `app/(app)/profile/actions.ts`), so somebody determined can invoke the finish
 * action without having looked at a single onboarding screen, and the flag will
 * be set. That is not a hole, because the flag guards a wizard and nothing else
 * — every field it collects is optional and there is a "Skip for now" button
 * that does exactly the same write. The property that matters is the one this
 * arrangement actually provides: the COLUMN has one writer, in server code, so
 * whatever "finished" is required to mean in future — a verified email, a
 * required field, an accepted agreement — there is a single place to enforce it
 * and no client-side path that bypasses it.
 *
 * ============================================================================
 * WHY THIS IS THE SEVENTH IMPORTER OF THE SERVICE-ROLE CLIENT
 * ============================================================================
 *
 * `service-role-client.ts` says adding a caller "is a decision, not a
 * convenience", and `no-second-write-path.test.ts` asserts the list by hand.
 * The check it asks for: could a policy have served this? No — a policy can only
 * widen what `authenticated` may write, and widening `authenticated`'s access to
 * this column is the exact thing 20260809211100 forbids. The write therefore has
 * to come from a role the client cannot be.
 *
 * What keeps it narrow: `assertSignupCompleted` takes one uuid and writes one
 * boolean. It has no other statement, no other column, no filter a caller
 * supplies, and its caller passes `context.userId` — a value derived from a
 * signature-verified Kinde token by `getAuthenticatedContext()`, never from a
 * form field or a URL.
 */

/**
 * Whether this account has finished onboarding.
 *
 * Read through the CALLER'S OWN RLS-bound client, not the service role, even
 * though the writer below needs the service role. The two are asymmetric on
 * purpose: `select` on `users` is granted to `authenticated` and the policy
 * already restricts the row to their own, so there is nothing here that needs
 * RLS bypassed — and the gate that consumes this answer runs on every signed-in
 * page, which is the last place to be doing unpoliced reads.
 *
 * Throws on failure rather than defaulting. A false default would drop a person
 * who has finished into the wizard on a transient error; a true default would
 * skip onboarding for a genuinely new account. Neither is a safe guess, so the
 * gate treats a failure as a failure (CLAUDE.md's fail-closed rule applied to a
 * read: an answer that cannot be obtained is not an answer).
 */
export async function hasCompletedSignup(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("users")
    .select("has_completed_signup")
    .eq("id", userId)
    .single<{ has_completed_signup: boolean }>();

  if (error) {
    throw new Error(`Failed to read onboarding state: ${error.message}`, { cause: error });
  }
  return data.has_completed_signup;
}

/**
 * Records that this account has been through onboarding.
 *
 * Idempotent by construction — writing `true` over `true` is a no-op — so the
 * "Skip for now" path, the "Done" path and a double-submitted form all converge
 * on the same state. `updated_at` is set alongside it because every other write
 * to this table sets it and a row whose flag changed without its timestamp
 * moving is a small lie in the audit trail.
 *
 * There is no `assertSignupIncomplete`, and there should not be one: nothing in
 * this product re-opens onboarding, and a server function that could un-finish
 * an account would be a way to force somebody back through a wizard. Restoring
 * a deleted account does not touch this column either — a restored member is
 * already set up.
 */
export async function assertSignupCompleted(userId: string): Promise<void> {
  const { error } = await serviceRoleClient()
    .from("users")
    .update({ has_completed_signup: true, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) {
    throw new Error(`Failed to record that onboarding finished: ${error.message}`, {
      cause: error,
    });
  }
}
