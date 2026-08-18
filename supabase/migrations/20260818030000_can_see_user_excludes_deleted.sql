-- =============================================================================
-- 20260818030000_can_see_user_excludes_deleted.sql
--
-- WHAT THIS CHANGES
--   Restates `private.can_see_user` (second revision; 20260815000820 wrote it)
--   so its two relationship branches — active connection, shared `going` RSVP —
--   require the TARGET not to be `deleted`. The self branch is untouched: a
--   person can always see themself, deleted or not. No policy text changes;
--   the one consumer of this function, the `profile-photos` storage SELECT
--   policy ("read profile photos of people you can see"), picks the new
--   behaviour up automatically.
--
-- WHY — THE GAP THIS CLOSES, AND WHY IT EXISTED
--   20260815130200 decided that a deleted account "is not readable through the
--   graph": it rebuilt the `users` SELECT policy so the relationship branches
--   test `users.status <> 'deleted'`. But it rebuilt that policy by INLINING
--   the branches rather than by amending `can_see_user` — its author had no
--   file for 20260815000820 to read (that migration was applied to the live
--   project without ever landing in the repo; see its provenance header) and
--   so did not know a second definition of "may read this profile" existed,
--   let alone that the photo policy hangs off it. Result: the profile ROW of
--   a deleted member disappeared from former connections while their PHOTO
--   remained fetchable through storage. Found during the 2026-08-18
--   error-diagnosis pass; fix approved by the project owner on the same PR.
--
-- WHAT AN ATTACK / MISUSE WOULD LOOK LIKE, AND WHAT THIS STOPS
--   Nothing here needs a determined attacker to matter: any former connection
--   of a deleted member could still load their photo (any screen that renders
--   a connection's avatar would do it, as would hitting storage with their own
--   valid session). The person deleted their account on the promise that
--   their "profile is hidden from everyone you've met" — the photo IS profile
--   content, so serving it makes that sentence false. After this migration the
--   relationship branches refuse, so the photo is exactly as gone as the row.
--
-- WHY THE SHAPE MIRRORS 20260815130200'S POLICY, DELIBERATELY
--   Same three decisions, same reasons:
--     * Self always passes — a deleted member still sees their own account
--       (their data is kept, the delete is reversible, and their own photo on
--       their own failure screen is not a disclosure).
--     * The status test wraps only the relationship branches, so "deleted"
--       means "unreachable through the graph", not "erased".
--     * `are_connected` / `shares_event_with` stay status-blind (20260815130200
--       note 3): the edge and RSVP rows still exist so the delete stays
--       reversible; the refusal belongs at "may I READ them", which is here.
--   The status test is one indexed primary-key lookup per policy evaluation.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: nothing new, to any role. EXECUTE grants on the function are
--     unchanged from 20260815000820.
--   Forbids: SELECT on `profile-photos` objects whose owner's `users.status`
--     is 'deleted', to every viewer except the owner themself — previously
--     allowed for active connections and co-attendees. The service role still
--     bypasses storage RLS entirely (unchanged; the card-preview path refuses
--     deleted owners in code before any photo is read).
-- =============================================================================

create or replace function private.can_see_user(p_viewer uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_viewer is not null and p_target is not null and (
    p_viewer = p_target
    or (
      exists (
        select 1 from public.users u
        where u.id = p_target
          and u.status <> 'deleted'
      )
      and (
        private.are_connected(p_viewer, p_target)
        or private.shares_event_with(p_viewer, p_target)
      )
    )
  );
$$;

comment on function private.can_see_user(uuid, uuid) is
  'Whether p_viewer may read p_target profile: self always; otherwise an active '
  'connection or a shared going RSVP AND the target is not deleted '
  '(20260818030000, mirroring the users policy 20260815130200 rebuilt). The '
  'single definition behind the profile-photos storage SELECT policy; the users '
  'SELECT policy states the same rule inline.';
