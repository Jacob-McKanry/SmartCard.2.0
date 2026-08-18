-- =============================================================================
-- 20260815000820_storage_rls_profile_photos_follow_profile_visibility.sql
--
-- PROVENANCE — THIS FILE RECORDS A MIGRATION THAT ALREADY RAN
--   This migration was applied to the live project on 2026-08-15 (version
--   20260815000820 in the project's migration history) but the repository
--   never received the file — discovered during the 2026-08-18 error-diagnosis
--   pass, alongside the same drift on 20260816053616. The SQL below is the
--   live migration's recorded statements, verbatim; only this header is new.
--   Without this file, a rebuild from the repo would produce the OLD storage
--   read policy ("read own profile photos only"), silently breaking every
--   screen that shows a connection's photo.
--
-- WHAT THIS CHANGES
--   1. Adds `private.profile_photo_owner_id(text)` — maps a profile-photos
--      object key (`{user_id}/...`) to that user id, or NULL for a malformed
--      key, pattern-matching before casting so garbage denies instead of
--      raising 22P02 inside a policy.
--   2. Adds `private.can_see_user(viewer, target)` — self, active connection,
--      or shared `going` RSVP; the single definition of "may read this
--      profile".
--   3. Replaces the profile-photos storage SELECT policy: photos become
--      readable by exactly the people who may read the owner's profile row,
--      instead of by the owner alone.
--   4. Restates the `users` SELECT policy in terms of `can_see_user` (this
--      restatement was later superseded: 20260815130200 replaced the `users`
--      policy again to hide deleted accounts, inlining the relationship
--      branches rather than calling `can_see_user` — see the note below).
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: SELECT on `profile-photos` storage objects to `authenticated`
--     viewers whom `private.can_see_user` admits for the photo's owner (self,
--     active connections, co-attendees) — previously owner-only. EXECUTE on
--     the two new `private` functions to `authenticated` (they are the policy
--     bodies; `security definer` on `can_see_user` is what lets the policy
--     consult connection/RSVP rows the viewer cannot read directly).
--   Forbids: nothing that was previously allowed. `anon` still has no grant.
--
-- NOTE RECORDED AT RE-DISCOVERY (2026-08-18): `can_see_user` does NOT test
--   `users.status`, so this storage policy still serves a DELETED user's photo
--   to their former connections even though 20260815130200 hides the profile
--   row itself. A one-line status test inside `can_see_user` would close it,
--   but that is a deliberate security-model decision (the same choice
--   20260815130200 §3 records for `are_connected`/`shares_event_with`) and is
--   flagged for review rather than smuggled into a provenance commit.
-- =============================================================================

create or replace function private.profile_photo_owner_id(p_name text)
returns uuid language sql immutable set search_path = ''
as $$
  select case
    when p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
      then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

comment on function private.profile_photo_owner_id(text) is
  'Maps a profile-photos object key to the id of the user who owns it, or NULL '
  'if the key does not start with a user id followed by a slash. Pattern-matches '
  'before casting so a malformed key denies instead of raising 22P02 in a policy.';

create or replace function private.can_see_user(p_viewer uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_viewer is not null and p_target is not null and (
    p_viewer = p_target
    or private.are_connected(p_viewer, p_target)
    or private.shares_event_with(p_viewer, p_target)
  );
$$;

comment on function private.can_see_user(uuid, uuid) is
  'Whether p_viewer may read p_target profile: self, an active connection, or a '
  'shared going RSVP. The single definition behind BOTH the users SELECT policy '
  'and the profile-photos storage SELECT policy.';

revoke all on function private.profile_photo_owner_id(text) from public, anon, authenticated;
revoke all on function private.can_see_user(uuid, uuid) from public, anon, authenticated;
grant execute on function private.profile_photo_owner_id(text) to authenticated;
grant execute on function private.can_see_user(uuid, uuid) to authenticated;

drop policy "read own profile photos only" on storage.objects;

create policy "read profile photos of people you can see"
on storage.objects for select
to authenticated
using (
  bucket_id = 'profile-photos'
  and (select private.can_see_user(
         (select auth.uid()),
         private.profile_photo_owner_id(objects.name)))
);

drop policy "read self, connections, and co-attendees only" on public.users;

create policy "read self, connections, and co-attendees only"
on public.users for select
to authenticated
using ((select private.can_see_user((select private.current_user_id()), users.id)));
