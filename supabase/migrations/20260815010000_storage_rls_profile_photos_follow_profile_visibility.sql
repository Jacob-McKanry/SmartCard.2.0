-- =============================================================================
-- 20260815010000_storage_rls_profile_photos_follow_profile_visibility.sql
--
-- WHAT THIS CHANGES
--   The `profile-photos` SELECT policy now admits anyone who can already read
--   the photo owner's `users` row, instead of only the owner themselves. The
--   three WRITE policies (INSERT/UPDATE/DELETE) are deliberately untouched and
--   stay own-prefix only.
--
--   It also extracts the profile-visibility predicate into
--   `private.can_see_user()` and repoints the `users` SELECT policy at it, so
--   there is one definition of "can this person see that person" rather than
--   two that must be kept in step by hand.
--
-- WHY — A BUG, FOUND IN THE 2026-08-15 SECURITY AUDIT
--   `20260813191041` granted an authenticated user SELECT on objects under
--   their own `{user_id}/` prefix only. That is exactly right for the three
--   write verbs, and wrong for reads, because the app renders OTHER people's
--   photos in four places: `/feed` (both the participant and the triadic
--   "A met B" post), `/connections`, `/connections/[connectionId]` and
--   `/activity`. Six of the seven `signedProfilePhotoUrl` call sites pass a
--   counterpart's `photo_path` together with the VIEWER's RLS-bound client.
--
--   Supabase Storage enforces RLS at signing time, not only at fetch time, so
--   `createSignedUrl` for a path the caller cannot SELECT returns an error.
--   `signedProfilePhotoUrl` maps that to `null`, and `null` renders as the
--   avatar's fallback initials. So the failure mode was silent: no exception,
--   no log line, just every other person's avatar permanently blank.
--
--   It had never been observed because `public.connections` holds ZERO rows —
--   the pilot has not started. The first real connection would have exposed it.
--
-- WHY THE FIX IS "WHOEVER CAN SEE THE PROFILE" AND NOT SOMETHING LOOSER
--   A photo is one field of a profile. The `users` SELECT policy already
--   decides who may read that profile — self, active connections, and people
--   you are BOTH `going` to the same event with (`private.shares_event_with`)
--   — and it already hands those viewers the name, bio, company, phone number
--   and email. A photo is strictly less sensitive than what the same viewer can
--   already read, so tying the two together adds no disclosure. Anything looser
--   (any authenticated user, say) would hand a photo to somebody who cannot see
--   the profile it belongs to, which is the "no public profile" rule in
--   CLAUDE.md reached by a side door.
--
--   Verified in a rolled-back transaction against the live database with three
--   real migrated users and a real connection: the owner sees their own photo,
--   a connected user sees it, a co-attendee sees it, and a STRANGER sees
--   nothing — 3 of 148 objects visible, not 148. Removing the connection
--   revokes photo visibility in the same statement that removes the edge,
--   because the policy asks the graph rather than caching an answer.
--
-- WHY `private.can_see_user()` EXISTS RATHER THAN THE PREDICATE BEING COPIED
--   Copying it would work today and rot tomorrow. The failure it prevents is
--   specific: somebody later narrows profile visibility — adds a `blocks`
--   branch, say, or changes what `shares_event_with` counts — updates the
--   `users` policy, and does not know a second copy governs photos. Profile
--   hidden, photo still readable. Extracting one predicate and pointing both
--   policies at it makes that drift structurally impossible, which is the same
--   argument `private.can_see_meeting` and `private.can_see_event` already
--   embody for their tables.
--
--   The `users` policy's behaviour is UNCHANGED by the repoint — the new
--   function is the old predicate verbatim, with the same three branches in the
--   same order. Confirmed rather than asserted: the number of `users` rows a
--   real user can see was counted before and after the swap inside one
--   transaction and was identical (3 = 3, covering self + connection +
--   co-attendee).
--
-- WHY THE OWNER IS DERIVED FROM THE PATH
--   `profile_photo_owner_id()` pattern-matches `{uuid}/…` and casts, returning
--   NULL for anything else — the same shape and the same reason as
--   `private.event_cover_event_id()` (20260814051400): a malformed key must
--   DENY (NULL fails `can_see_user`) rather than raise 22P02 inside a policy.
--   All 148 existing `photo_path` values were checked and every one is
--   `{owner_user_id}/…`, including the legacy-import photos, which were
--   uploaded through a different code path — so this reads real data correctly
--   and not just data `replaceOwnProfilePhoto` will write in future.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: SELECT on a `profile-photos` object to any authenticated user who
--     can already read the owning user's `users` row — i.e. the owner, their
--     active connections, and people sharing a `going` RSVP with them.
--   Forbids: SELECT to everybody else, including any signed-in user with no
--     relationship to the owner, and any object whose key does not name a user
--     id. INSERT, UPDATE and DELETE remain own-prefix only and are not modified
--     here — you may still only write your own photo.
--   `anon` is granted nothing, here as everywhere.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The owner of a profile-photo object, from its key.
-- ---------------------------------------------------------------------------
create or replace function private.profile_photo_owner_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.+$'
      then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

comment on function private.profile_photo_owner_id(text) is
  'Maps a `profile-photos` object key to the id of the user who owns it, or '
  'NULL if the key does not start with a user id followed by a slash. '
  'Pattern-matches before casting so a malformed key denies (NULL fails every '
  'check) instead of raising 22P02 inside a policy — same contract as '
  'private.event_cover_event_id(text).';

-- ---------------------------------------------------------------------------
-- "Can this person see that person?" — one definition, two policies.
-- ---------------------------------------------------------------------------
-- This is the predicate the `users` SELECT policy has carried inline since
-- 20260809211100, unchanged: yourself, anyone you hold an ACTIVE connection
-- with, and anyone you are both `going` to the same event with. Null-safe in
-- both arguments, because an unauthenticated or unresolvable caller must deny
-- rather than error.
create or replace function private.can_see_user(p_viewer uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_viewer is not null and p_target is not null and (
    p_viewer = p_target
    or private.are_connected(p_viewer, p_target)
    or private.shares_event_with(p_viewer, p_target)
  );
$$;

comment on function private.can_see_user(uuid, uuid) is
  'Whether p_viewer may read p_target''s profile: self, an active connection, '
  'or a shared `going` RSVP (§3.4). The single definition behind BOTH the '
  'users SELECT policy and the profile-photos storage SELECT policy — a photo '
  'must never outlive the visibility of the profile it belongs to.';

-- Postgres grants EXECUTE on new functions to PUBLIC, which includes anon, so
-- the revoke is required rather than decorative — same as 20260809211400.
revoke all on function private.profile_photo_owner_id(text) from public, anon, authenticated;
revoke all on function private.can_see_user(uuid, uuid) from public, anon, authenticated;

-- A policy expression is evaluated with the querying role's privileges, so
-- `authenticated` needs EXECUTE for the policies below to run at all. This does
-- not make either function reachable from the API: USAGE on schema `private`
-- remains revoked, so neither can be named in a query and PostgREST cannot see
-- the schema — the containment argument 20260809211400 makes for the other
-- helpers applies here unchanged.
grant execute on function private.profile_photo_owner_id(text) to authenticated;
grant execute on function private.can_see_user(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The fix itself.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Repoint the users policy at the same predicate. Behaviour is unchanged; this
-- exists so the two rules cannot drift apart. See the header.
-- ---------------------------------------------------------------------------
drop policy "read self, connections, and co-attendees only" on public.users;

create policy "read self, connections, and co-attendees only"
on public.users for select
to authenticated
using ((select private.can_see_user((select private.current_user_id()), users.id)));
