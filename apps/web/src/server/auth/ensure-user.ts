import "server-only";

import { serviceRoleClient } from "@/server/supabase/service-role-client";
import type { KindeIdentity } from "@/server/auth/kinde-identity";

/**
 * Step 2 of the Kinde -> Supabase bridge: resolve a verified Kinde identity to
 * the `public.users` row it owns, creating that row on first login (§5.3).
 *
 * WHY THIS RUNS WITH THE SERVICE ROLE
 *
 * There is no client-facing INSERT policy on `users`, and that absence is a
 * security decision recorded in
 * `supabase/migrations/20260809211100_rls_policies_identity_and_cards.sql`: a
 * client able to insert its own row is a client able to choose its own
 * `kinde_user_id`, which is choosing which account it is. The row therefore has
 * to be created by something the client cannot instruct — this function, using
 * the service role, with the `kinde_user_id` taken from a *signature-verified*
 * token rather than from anything the caller typed.
 *
 * WHY LOOKUP IS BY `kinde_user_id` AND NEVER BY EMAIL
 *
 * `kinde_user_id` is the sole link to Kinde (§2.1, §5.3). Falling back to
 * "no row with that Kinde id, but there is one with that email, so it must be
 * the same person" would be an account-takeover primitive: anyone who can get
 * Kinde to issue them a token carrying somebody else's email address inherits
 * that person's SmartCard account, their cards and their graph. So an email
 * collision is surfaced as an error for a human to resolve, not auto-linked.
 * See `EmailAlreadyBoundToAnotherIdentityError` below.
 *
 * WHAT THIS MEANS FOR THE 337 MIGRATED USERS
 *
 * All 337 rows already carry the `kinde_user_id` they will log in with (Q6,
 * verified 337/337 at import). For every one of them this function is a lookup
 * that finds an existing row — the insert branch is for genuinely new signups
 * only. That is why §6.1 insisted the user import complete *before* anyone can
 * log in: a legacy user logging in first would have hit the insert branch and
 * created an empty duplicate, and the import would then have failed on the
 * unique constraint for that person.
 */

/** A user exists but is not allowed to hold a session. */
export class UserNotActiveError extends Error {
  constructor(readonly status: string) {
    super(`This account's status is '${status}', so it cannot start a session.`);
    this.name = "UserNotActiveError";
  }
}

/** Kinde asserted an email that already belongs to a different SmartCard account. */
export class EmailAlreadyBoundToAnotherIdentityError extends Error {
  constructor() {
    super(
      "A SmartCard account already exists with this email address but a different Kinde user id. " +
        "This is not auto-linked on purpose — linking accounts by email would let a token " +
        "carrying somebody else's address take over their account. Resolve it by hand.",
    );
    this.name = "EmailAlreadyBoundToAnotherIdentityError";
  }
}

/** Kinde gave us no email, and `users.email` is NOT NULL. */
export class MissingEmailClaimError extends Error {
  constructor() {
    super(
      "Kinde did not supply an email address for this identity, so a users row cannot be created. " +
        "Check that the `email` scope is requested and that the Kinde application returns it.",
    );
    this.name = "MissingEmailClaimError";
  }
}

/** Postgres unique-violation SQLSTATE, as surfaced by PostgREST. */
const UNIQUE_VIOLATION = "23505";

interface ExistingUserRow {
  id: string;
  status: string;
}

async function findByKindeUserId(kindeUserId: string): Promise<ExistingUserRow | null> {
  const { data, error } = await serviceRoleClient()
    .from("users")
    .select("id, status")
    .eq("kinde_user_id", kindeUserId)
    .maybeSingle<ExistingUserRow>();

  if (error) {
    throw new Error(`Failed to look up users row by kinde_user_id: ${error.message}`, {
      cause: error,
    });
  }
  return data;
}

/**
 * Returns the caller's `public.users.id` — the value `auth.uid()` must resolve
 * to for RLS to work, and therefore the value the minted Supabase token's `sub`
 * is set to.
 */
export async function ensureUser(identity: KindeIdentity): Promise<string> {
  const existing = await findByKindeUserId(identity.kindeUserId);

  if (existing !== null) {
    assertActive(existing.status);
    return existing.id;
  }

  if (identity.email === null) {
    throw new MissingEmailClaimError();
  }

  // Only the columns a brand-new account can honestly assert are set here.
  // `has_completed_signup` stays false: onboarding is a thing the server
  // observes finishing, not a thing a fresh row claims. `is_admin` and `status`
  // keep their database defaults so that "new user" can never mean "admin".
  const { data, error } = await serviceRoleClient()
    .from("users")
    .insert({
      kinde_user_id: identity.kindeUserId,
      email: identity.email,
      first_name: identity.firstName,
      last_name: identity.lastName,
      email_verified: identity.emailVerified,
    })
    .select("id, status")
    .single<ExistingUserRow>();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // Two requests for the same brand-new user can race between the SELECT
      // above and this INSERT (a browser making parallel requests right after
      // callback is enough). Losing that race is normal, not an error: re-read
      // and use the row the winner created.
      const raced = await findByKindeUserId(identity.kindeUserId);
      if (raced !== null) {
        assertActive(raced.status);
        return raced.id;
      }
      // Not our own id colliding, so it is a different unique constraint —
      // in practice `users_email_key`. Never auto-link; see the header.
      throw new EmailAlreadyBoundToAnotherIdentityError();
    }
    throw new Error(`Failed to create users row: ${error.message}`, { cause: error });
  }

  assertActive(data.status);
  return data.id;
}

/**
 * Suspended and deleted accounts are stopped here, at the point tokens are
 * minted, rather than in RLS.
 *
 * That placement is deliberate and is documented at
 * `private.current_user_id()` in
 * `supabase/migrations/20260809210900_rls_helper_functions.sql`: the helper is a
 * thin wrapper over `auth.uid()` with no table access, partly to avoid a policy
 * that reads `users` being evaluated by the `users` policy, and partly because
 * account status is an authentication question. A suspended user should never
 * receive a Supabase JWT in the first place — which is this line.
 */
function assertActive(status: string): void {
  if (status !== "active") {
    throw new UserNotActiveError(status);
  }
}
