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

interface ClaimPlaceholderRpcResult {
  claimed: boolean;
  id?: string;
  status?: string;
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
 * Claims a `status = 'placeholder'` row by email — the row
 * `create_manual_connection` (20260926130000) created for someone who had no
 * account yet when they were scanned or manually added as a connection.
 *
 * WHY THIS IS ONE RPC RATHER THAN A SELECT FOLLOWED BY AN UPDATE
 *
 * `no-second-write-path.test.ts` enforces, project-wide, that `users.status`
 * is written from exactly one atomic place (today,
 * `public.soft_delete_own_account()`) rather than by application code doing
 * a read-then-write — the same reasoning that function's own header gives:
 * a `.update()` from here would in fact fail (`status` is outside `users`'
 * column-level UPDATE grant, 20260809211100), and worse, an application-level
 * SELECT-then-UPDATE lets two concurrent signups both read `'placeholder'`
 * before either writes, each believing it won the claim. `claim_placeholder_user`
 * (20260926140000) does the lookup and the update inside one `plpgsql`
 * function, `for update` locked, so it is atomic by construction.
 *
 * WHY THIS ONLY MATCHES ON EMAIL, NOT PHONE TOO
 *
 * `create_manual_connection` itself matches an "already has an account" contact
 * by email OR phone (the owner's explicit choice — see
 * docs/architecture/2026-09-26-unverified-connections.md). This function is a
 * different moment: claiming a placeholder on REAL signup, which only ever has
 * `KindeIdentity`'s claims to go on, and Kinde does not hand back a phone
 * number here (`kinde-identity.ts`'s `KindeIdentity` has no phone field at
 * all). Phone-based claiming would need a separate, later flow (e.g. the user
 * entering their phone in Profile) — out of scope for this function, which can
 * only act on what a real login actually asserts.
 */
async function claimPlaceholderByEmail(
  email: string,
  identity: KindeIdentity,
): Promise<ExistingUserRow | null> {
  const { data, error } = await serviceRoleClient().rpc("claim_placeholder_user", {
    p_email: email,
    p_kinde_user_id: identity.kindeUserId,
    p_email_verified: identity.emailVerified,
    p_first_name: identity.firstName,
    p_last_name: identity.lastName,
  });

  if (error) {
    throw new Error(`Failed to claim placeholder users row: ${error.message}`, { cause: error });
  }

  const result = data as ClaimPlaceholderRpcResult | null;
  if (result === null || result.claimed !== true) {
    return null;
  }
  if (typeof result.id !== "string" || typeof result.status !== "string") {
    throw new Error("claim_placeholder_user returned claimed:true with a malformed shape");
  }
  return { id: result.id, status: result.status };
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

  // Claim a placeholder row before creating a brand-new one (2026-09-26,
  // docs/architecture/2026-09-26-unverified-connections.md): someone may
  // already have been scanned or manually added as a connection by another
  // user before ever signing up themselves. That created a `status =
  // 'placeholder'` row with this same email and no `kinde_user_id`
  // (`create_manual_connection`). Claiming it IN PLACE — same `id`, `status`
  // flips to `'active'`, `kinde_user_id` set — is what keeps every
  // `connections`/`meetings` row that already points at that id valid; a
  // second, brand-new row would leave those edges pointing at an account
  // nobody can ever log into, and would also collide on `users.email`'s
  // UNIQUE constraint the moment the ordinary insert below ran.
  const claimed = await claimPlaceholderByEmail(identity.email, identity);
  if (claimed !== null) {
    assertActive(claimed.status);
    return claimed.id;
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
