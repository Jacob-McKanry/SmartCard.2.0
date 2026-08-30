-- =============================================================================
-- 20260830130000_storage_admin_read_applicant_photos.sql
--
-- WHAT THIS CHANGES
--   Adds one additional SELECT policy on `storage.objects` for the
--   `profile-photos` bucket. The existing "read own profile photos only"
--   policy (20260813191041) is untouched — Postgres combines multiple
--   permissive policies for the same command with OR, so this widens who may
--   read a photo without narrowing or replacing the self-only rule everyone
--   else still relies on.
--
-- WHY THIS EXISTS
--   §9.3's admin review queue is meant to show "the applicant's existing
--   profile (name, photo)". `admin_list_host_applications` (20260830120000)
--   already solves the name half via a `security definer` join, because
--   `users`' own SELECT grant has no admin branch. Photos are a second,
--   separate wall: `profile-photos` is signed URLs from Storage, and Storage
--   enforces its OWN RLS at signing time
--   (`storage.foldername(name))[1] = auth.uid()`), so an admin's ordinary
--   RLS-bound client cannot mint a signed URL for anybody else's path — the
--   `createSignedUrl` call itself fails with no override available in
--   TypeScript. `photo-url.ts` says exactly why the service role is not used
--   to route around a Storage policy: "Using the service role here would
--   silently bypass the exact check this module exists to respect."
--
--   So the fix is the same shape §3.1 asks for everywhere else in this
--   schema: widen the actual policy, narrowly, rather than reach for the
--   service role in application code.
--
-- ===========================================================================
-- WHY THIS POLICY AND NOT A BROADER ONE
-- ===========================================================================
--   Two conditions, both required: the caller is an ACTIVE admin
--   (`private.is_admin()`, the same helper `admin_list_host_applications` and
--   `decide_host_application` already use), AND the path's owner has a row in
--   `host_applications` — i.e. this only ever admits a photo belonging to
--   somebody who actually applied. An admin gains no ability to read any other
--   user's photo through this policy; the set of readable paths is exactly the
--   set `admin_list_host_applications` already discloses names for.
--
--   Not scoped to `status = 'pending'` only. An admin reviewing a decision they
--   already made (§9.3's approved/rejected history) still needs the photo to
--   render, and `host_applications_one_per_user`'s replace-on-reapply behaviour
--   means the row for a rejected applicant who has not reapplied still exists
--   with `status = 'rejected'` — narrowing to pending would make history views
--   silently lose photos for anybody not currently in the queue.
--
-- ===========================================================================
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
-- ===========================================================================
--   Grants: SELECT on `profile-photos` objects to an active admin, for paths
--     whose first segment is the id of somebody who has submitted a host
--     application (any status).
--   Forbids: everything else, unchanged. A non-admin gains nothing — the
--     policy's first condition refuses them outright. An admin gains nothing
--     for a user who has never applied — the `exists` clause refuses that.
-- =============================================================================

create policy "admin may read host-applicant profile photos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'profile-photos'
  and private.is_admin()
  and exists (
    select 1
    from public.host_applications ha
    where ha.user_id::text = (storage.foldername(name))[1]
  )
);
