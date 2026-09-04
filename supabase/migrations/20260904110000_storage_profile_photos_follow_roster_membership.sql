-- =============================================================================
-- 20260904110000_storage_profile_photos_follow_roster_membership.sql
--
-- WHAT THIS CHANGES, AND THE GAP IT CLOSES
--   20260904100000 gave `event_roster`/`event_attendee_profile` a wider
--   population than `private.can_see_user` ever covered: `is_event_roster_member`
--   admits a HOST (no RSVP row for their own event) and a CLAIMED-CSV-IMPORT
--   attendee (`event_attendee_imports.claimed_by_user_id`, also no RSVP row —
--   neither `claim_event_import` nor `import_event_attendees` writes one), on
--   top of the ordinary `going` RSVP case. `private.can_see_user`, which gates
--   the `profile-photos` storage SELECT policy
--   (20260815000820_storage_rls_profile_photos_follow_profile_visibility.sql),
--   only ever covers `are_connected` or `shares_event_with` — and
--   `shares_event_with` requires BOTH people to hold a `going` RSVP row to the
--   SAME event (20260904100000's own retrofit did not change that join, only
--   added the opt-in gate on top of it).
--
--   The practical break, found by re-reading that join rather than assumed
--   correct: a host viewing the roster of their own event, or any attendee
--   who reached the roster only through a claimed guest-list row, would get a
--   real `photo_path` back from `event_attendee_profile` — the RPC is
--   `security definer` and does not touch storage — and then fail to render
--   or save that photo, because minting a signed URL for it
--   (`signedProfilePhotoUrl`) or downloading its bytes for a vCard both go
--   through the caller's own RLS-bound client, which the existing storage
--   policy would refuse. Not a security hole — the refusal is in the SAFE
--   direction — but a correctness bug this migration exists to fix before the
--   roster UI ships and hits it.
--
--   Adds `private.shares_roster_event_with(viewer, other)` — mirrors
--   `is_event_roster_member` (not `shares_event_with`'s narrower RSVP-only
--   join) on BOTH sides, plus the same opt-in gate on the subject, plus the
--   same live/not-cancelled event gate `event_roster` itself applies. Widens
--   the `profile-photos` storage SELECT policy to admit a read when EITHER
--   the existing `can_see_user` branch OR this new branch says yes.
--
-- WHY A NEW, NARROWER HELPER RATHER THAN WIDENING `can_see_user` ITSELF
--   `can_see_user` also backs the `public.users` SELECT policy
--   (20260815000820) — the policy that lets a client's own `.from("users")`
--   query return another person's ROW directly. Widening it to the roster's
--   population would let any two people who merely share a roster-visible
--   event read each OTHER's full `users` row through ordinary PostgREST
--   queries (every column the existing SELECT grant covers, not just the
--   curated field set `event_attendee_profile` deliberately returns), which
--   is a materially bigger surface than "may view this one photo" and was
--   never asked for. This helper is scoped to exactly the one thing it is
--   needed for — storage — and is not called from the `users` policy at all.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: an authenticated viewer may now SELECT a `profile-photos` object
--     when its owner is roster-visible to them — i.e. both are members of a
--     live (started, non-cancelled), roster-eligible event's population
--     (host, `going` RSVP, or claimed guest-list row) and the owner has
--     `roster_visibility = 'visible'` — in addition to every case already
--     admitted by `can_see_user` (self, active connection, mutual `going`
--     RSVP with the subject opted in). This closes the exact gap above: a
--     host or a claimed-only attendee can now actually read a co-attendee's
--     photo through the same client the roster UI already uses everywhere
--     else.
--   Forbids: nothing previously allowed. A `hidden`/unanswered subject's
--     photo is refused by this new branch exactly as it already is by
--     `can_see_user`'s roster-aware `shares_event_with`; an event that has
--     not started, is cancelled, or where the viewer is not themselves a
--     roster member also refuses, matching `event_roster`'s own gate exactly
--     so a photo is never readable through storage before the profile data it
--     belongs to would be.
--
-- VERIFIED LIVE in a rolled-back transaction before applying: a host with no
--   RSVP to their own event can now read a claimed-import attendee's photo
--   object where they could not before; a claimed-import-only attendee (no
--   RSVP) can read another opted-in roster member's photo; a `hidden`
--   co-attendee's photo is still refused through this branch; an unstarted
--   event's photos are still refused through this branch even though the
--   viewer is genuinely a roster member; every case `can_see_user` already
--   admitted (self, connection, mutual-RSVP-with-opt-in) is unaffected.
-- =============================================================================

create or replace function private.shares_roster_event_with(p_viewer uuid, p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_viewer is not null
     and p_other is not null
     and p_viewer <> p_other
     and coalesce(
       (select u.roster_visibility from public.users u where u.id = p_other),
       'hidden'
     ) = 'visible'
     and exists (
       select 1
       from public.events e
       where e.status <> 'cancelled'
         and e.starts_at <= now()
         and private.is_event_roster_member(p_viewer, e.id)
         and private.is_event_roster_member(p_other, e.id)
     );
$$;

comment on function private.shares_roster_event_with(uuid, uuid) is
  'Whether p_viewer and p_other are both members (host, going RSVP, or claimed '
  'guest-list row — private.is_event_roster_member) of the same live, '
  'non-cancelled event, with p_other opted into the roster '
  '(roster_visibility = ''visible''). Wider than private.shares_event_with''s '
  'RSVP-only join on purpose: it exists to admit a host or a claimed-only '
  'attendee to a co-attendee''s photo, matching event_roster/'
  'event_attendee_profile''s own population exactly. Backs ONLY the '
  'profile-photos storage SELECT policy below — not called from the users '
  'SELECT policy, which stays on the narrower can_see_user (see this '
  'migration''s header for why widening that one would be a bigger grant '
  'than intended).';

revoke all on function private.shares_roster_event_with(uuid, uuid) from public, anon, authenticated;
grant execute on function private.shares_roster_event_with(uuid, uuid) to authenticated;

drop policy "read profile photos of people you can see" on storage.objects;

create policy "read profile photos of people you can see"
on storage.objects for select
to authenticated
using (
  bucket_id = 'profile-photos'
  and (
    (select private.can_see_user(
       (select auth.uid()),
       private.profile_photo_owner_id(objects.name)))
    or (select private.shares_roster_event_with(
       (select auth.uid()),
       private.profile_photo_owner_id(objects.name)))
  )
);
