import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminHostApplicationListSchema,
  hostApplicationRowSchema,
  type AdminHostApplication,
  type HostApplicationRow,
  type HostApplicationStatus,
  type SubmitHostApplicationInput,
} from "@smartcard/types";

import { UserFacingError } from "@/server/errors";

/**
 * The service layer for §9 of
 * `docs/architecture/2026-08-22-event-attendee-import.md` — becoming, and
 * approving, a verified host. Three surfaces, three different access models:
 *
 *   1. `submitHostApplication` / `getOwnHostApplication` — an applicant acting
 *      on their own row. The write goes through `submit_host_application`
 *      because the caller has no write grant on `host_applications` at all
 *      (the RPC exists to force `status = 'pending'` and clear a stale
 *      decision atomically); the read is an ORDINARY `select` through the
 *      caller's own RLS-bound client, because the table's own SELECT policy
 *      already admits "your own row" — no RPC needed for that half.
 *   2. `adminListHostApplications` — the review queue. `users`' SELECT grant
 *      has no admin branch (20260814230000), so an admin cannot join their own
 *      way to an applicant's name; `admin_list_host_applications`
 *      (20260830120000) is the one narrow place that join happens, and it
 *      fails closed to an empty array for a non-admin rather than an
 *      exception.
 *   3. `decideHostApplication` — the only writer of `users.is_verified_host`
 *      anywhere. Re-decidable on purpose: calling it with `approve: false` on
 *      an already-approved application is how verification is REVOKED (§9.4),
 *      which needs no second function.
 */

/**
 * Whether the CALLER is currently an active admin.
 *
 * FOR DRAWING A SCREEN, NEVER FOR DECIDING ONE — the same rule
 * `isVerifiedHost` in `attendee-import-service.ts` carries, for the identical
 * reason: `admin_list_host_applications` and `decide_host_application` both
 * re-derive admin status from `private.is_admin()` themselves, so a `true`
 * from here buys nobody anything except which page they see.
 *
 * Fails CLOSED (CLAUDE.md): any error answers `false`, which 404s the review
 * queue for a real admin during an outage rather than rendering an empty or
 * broken queue to somebody probing the route.
 */
export async function isAdmin(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) {
    console.error("[hosting/admin] is_admin failed", {
      error: error.message,
      cause: JSON.stringify(error),
    });
    return false;
  }
  return data === true;
}

/**
 * Submits or replaces the caller's own host application. Always lands as
 * `pending` — the RPC forces that, so a re-application after rejection cannot
 * be mistaken for an automatic re-approval.
 *
 * @throws {UserFacingError} If the caller is not signed in with an active
 *   account, or a required field was blank after trimming.
 */
export async function submitHostApplication(
  supabase: SupabaseClient,
  input: SubmitHostApplicationInput,
): Promise<void> {
  const { error } = await supabase.rpc("submit_host_application", {
    p_organization_name: input.organizationName,
    p_applicant_role: input.applicantRole,
    p_past_event_link: input.pastEventLink,
    p_expected_event_size: input.expectedEventSize ?? null,
    p_hosting_frequency: input.hostingFrequency ?? null,
  });

  if (error) {
    throw submitRefusal(error);
  }
}

function submitRefusal(error: { code?: string; message: string }): Error {
  switch (error.code) {
    case "42501":
      return new UserFacingError("You need to be signed in to apply.", { cause: error });
    case "22023":
      return new UserFacingError(
        "Organization, your role, and a link to a past event are all required.",
        { cause: error },
      );
    default:
      return new Error(`Failed to submit the host application: ${error.message}`, { cause: error });
  }
}

/**
 * The caller's own application, or `null` if they have never applied.
 *
 * ORDINARY SELECT, NOT AN RPC. `host_applications`' own policy
 * (`user_id = private.current_user_id() or private.is_admin()`) already
 * admits this row through the caller's RLS-bound client; there is nothing an
 * RPC would add for reading your own single row. `maybeSingle` rather than
 * `single`, because "never applied" is the common case for most visitors to
 * `/host/apply`, not an error.
 */
export async function getOwnHostApplication(
  supabase: SupabaseClient,
): Promise<HostApplicationRow | null> {
  const { data, error } = await supabase
    .from("host_applications")
    .select(
      "id, user_id, organization_name, applicant_role, past_event_link, expected_event_size, hosting_frequency, status, submitted_at, decided_at, decided_by_user_id, rejection_note",
    )
    .maybeSingle();

  if (error) {
    // Fail closed in the direction that matters here (CLAUDE.md): a caller who
    // cannot be told their own application status must not be shown the "no
    // application yet" screen, which invites submitting a SECOND one over a
    // transient read failure. Thrown, not swallowed to null.
    throw new Error(`Failed to load your host application: ${error.message}`, { cause: error });
  }
  if (data === null) {
    return null;
  }

  const parsed = hostApplicationRowSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("host_applications returned an unexpected shape", { cause: parsed.error });
  }
  return parsed.data;
}

/**
 * The review queue, joined with the applicant's name and photo — see
 * `admin_list_host_applications`'s own header for why that join has to happen
 * server-side in the database rather than here.
 *
 * FAILS CLOSED TO AN EMPTY LIST, deliberately mirroring the RPC's own
 * non-admin behaviour rather than throwing on a transport error. This queue's
 * empty state ("nothing to review") already renders correctly for the
 * overwhelmingly common non-admin case, and there is exactly one caller of
 * this function — a page gated `notFound()` for anybody who isn't an admin
 * before this ever runs — so the two failure modes (not an admin; a transient
 * database error) are already indistinguishable from where they are called,
 * and collapsing them here costs nothing a real admin would notice twice.
 */
export async function adminListHostApplications(
  supabase: SupabaseClient,
  status: HostApplicationStatus = "pending",
): Promise<AdminHostApplication[]> {
  const { data, error } = await supabase.rpc("admin_list_host_applications", {
    p_status: status,
  });

  if (error) {
    console.error("[hosting/admin] admin_list_host_applications failed", {
      error: error.message,
      cause: JSON.stringify(error),
    });
    return [];
  }

  const parsed = adminHostApplicationListSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[hosting/admin] admin_list_host_applications returned an unexpected shape", {
      cause: parsed.error,
    });
    return [];
  }
  return parsed.data;
}

/**
 * Approves or rejects one application, and sets `users.is_verified_host` to
 * match — one transaction inside `decide_host_application`, so there is no
 * instant where the application says approved and the flag still says false.
 *
 * @param approve `false` on an already-approved application REVOKES
 *   verification (§9.4) — there is no separate "revoke" function, this is it.
 * @param rejectionNote Shown to the applicant verbatim. Write it as a
 *   sentence a person can act on, never a copy of internal suspicion — the
 *   function's own comment says the same thing, stated here too because this
 *   is the form field that writes it.
 * @throws {UserFacingError} If the caller is not an active admin, or the
 *   application id does not exist. Both refuse identically (§3.6-style — see
 *   the RPC's own comment) so this cannot be used to probe which ids are real.
 */
export async function decideHostApplication(
  supabase: SupabaseClient,
  applicationId: string,
  approve: boolean,
  rejectionNote?: string,
): Promise<void> {
  const { error } = await supabase.rpc("decide_host_application", {
    p_application_id: applicationId,
    p_approve: approve,
    p_rejection_note: rejectionNote ?? null,
  });

  if (error) {
    throw decideRefusal(error);
  }
}

function decideRefusal(error: { code?: string; message: string }): Error {
  switch (error.code) {
    case "42501":
      return new UserFacingError(
        "You can't decide that application. That needs an active admin account and a real application id.",
        { cause: error },
      );
    default:
      return new Error(`Failed to decide the host application: ${error.message}`, { cause: error });
  }
}
