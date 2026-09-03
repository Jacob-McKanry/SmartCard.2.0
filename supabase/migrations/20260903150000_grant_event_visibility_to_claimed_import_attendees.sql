-- =============================================================================
-- 20260903150000_grant_event_visibility_to_claimed_import_attendees.sql
--
-- WHAT THIS CHANGES
--   Adds `private.has_claimed_import_for_event(uuid)`, widens
--   `private.can_see_event()` with a claimed-import-attendee branch, and adds
--   the identical branch (via the new helper) to the `events` table's own
--   SELECT policy.
--
-- ===========================================================================
-- THE BUG, FOUND TESTING THE AUTO-ATTACH FEATURE — BUT NOT CAUSED BY IT
-- ===========================================================================
--   Found live: a user auto-claimed (20260903140000) into a PRIVATE event
--   with no RSVP and no invite could not load that event's own page —
--   `getEventForViewer` 404'd. Tracing it back: neither `private.can_see_event()`
--   nor the `events` table's own SELECT policy (20260901120000) has ever had
--   a branch for "you hold a CLAIMED event_attendee_imports row for this
--   event." Only four branches existed: public+scheduled, host, RSVP'd,
--   invited.
--
--   This is NOT new with auto-claim. §4.2 step 5 of the 2026-08-22 import
--   design has always been "land on the event" — the LAST step of the
--   ORDINARY, manual, click-the-emailed-link claim flow, built and verified
--   2026-08-28. Anyone who claimed a private event's guest-list row with no
--   RSVP and no invite has been hitting this exact 404 since that date; it
--   simply had not been noticed, because every scenario verified at the time
--   happened to also have (or not need) one of the four existing branches.
--   Auto-claim is what surfaced it in practice — a claim with no click and
--   no chance for the person to separately RSVP first — not what created it.
--
-- ===========================================================================
-- WHY A NEW HELPER FUNCTION, NOT A DIRECT EXISTS IN THE POLICY
-- ===========================================================================
--   `event_attendee_imports` has zero grants to `authenticated` (20260827130000)
--   — RLS is forced with no policy at all. A bare
--   `exists (select 1 from event_attendee_imports where ...)` written
--   directly into the `events` policy would fail with a permission error for
--   every ordinary caller, because referencing a table at all — even inside a
--   subquery — requires the querying role's own GRANT, independent of RLS.
--   `private.has_claimed_import_for_event()` is `security definer`, so it
--   reads with the function owner's privileges instead, the same reason
--   every other RLS helper in this schema (`can_see_event`, `is_event_host`,
--   …) exists.
--
-- ===========================================================================
-- WHY THE EVENTS POLICY CALLS THE NEW HELPER DIRECTLY, NOT can_see_event()
-- ===========================================================================
--   `can_see_event()` itself queries `public.events e where e.id = p_event_id`
--   as its own outer FROM clause — the exact self-reference shape
--   `20260901120000` diagnosed and fixed: a policy on `events` calling a
--   function that re-queries `events` breaks `INSERT ... RETURNING`, because
--   the freshly-inserted row is invisible to the nested function's own
--   separate scan within the same command. That is why the `events` policy
--   is deliberately INLINED rather than calling `can_see_event()`, and it
--   stays that way here: the new branch calls
--   `has_claimed_import_for_event()`, which queries ONLY
--   `event_attendee_imports`, never `events` — no self-reference, verified
--   below with the identical `INSERT ... RETURNING` regression check
--   `20260901120000` used.
--
-- ===========================================================================
-- WHY can_see_event() ITSELF ALSO NEEDED THE BRANCH, NOT JUST THE POLICY
-- ===========================================================================
--   `can_see_event()` gates three other things directly: the RSVP write path
--   (`request_event_rsvp`/`withdraw_event_rsvp`, 20260814051200), the
--   event-cover storage policy (20260814051400), and
--   `event_attendance_counts` (20260814190000). Fixing only the `events`
--   table's policy would have stopped the 404 but left a claimed attendee
--   looking at a page with a missing cover image and refused attendance
--   counts — a different, still-broken experience. `can_see_event()` is
--   already `security definer`, so it can reference
--   `event_attendee_imports` directly without a separate helper; only the
--   POLICY needed one.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: a caller with a CLAIMED `event_attendee_imports` row for an
--     event can now SELECT that event, request its attendance counts, read
--     its cover image, and (per `can_see_event`'s pre-existing use in the
--     RSVP write path) RSVP to or withdraw from it — all things a host,
--     RSVP'd, or invited caller could already do for events they can see.
--   Forbids: everything else is unchanged. An UNCLAIMED (pending) import row
--     grants nothing — there is no viewer to grant it to until the row is
--     actually claimed. A stranger with no host/RSVP/invite/claim
--     relationship to a private event still cannot see it.
--
-- VERIFIED LIVE in a rolled-back transaction before applying: a claimed
--   attendee can now SELECT a private event they were not invited to or
--   RSVP'd for; a stranger with none of the four (now five) relationships
--   still cannot; `can_see_event()` agrees in both directions;
--   `event_attendance_counts` now succeeds for the claimed attendee instead
--   of refusing; a fresh `INSERT ... RETURNING` on `events` still works
--   (the self-reference regression check); an UNCLAIMED pending row grants
--   nobody visibility. Re-verified against the deployed function and policy
--   after applying, including against the real account/event pair that
--   surfaced the bug.
-- =============================================================================

create or replace function private.has_claimed_import_for_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.event_attendee_imports ei
    where ei.event_id = p_event_id
      and ei.claimed_by_user_id = private.current_user_id()
  );
$$;

comment on function private.has_claimed_import_for_event(uuid) is
  'Whether the caller holds a CLAIMED event_attendee_imports row for this '
  'event. Exists so the events SELECT policy (which cannot reference '
  'event_attendee_imports directly — that table has zero grants to '
  'authenticated) can admit a claimed import attendee without re-querying '
  '`events` itself (which is what 20260901120000''s self-reference bug was '
  'about). Security definer for the same reason every other RLS helper in '
  'this schema is: the policy needs it to see a row the caller could not '
  'otherwise.';

revoke all on function private.has_claimed_import_for_event(uuid) from public, anon, authenticated;
grant execute on function private.has_claimed_import_for_event(uuid) to authenticated;

create or replace function private.can_see_event(viewer uuid, p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select viewer is not null
     and p_event_id is not null
     and exists (
       select 1
       from public.events e
       where e.id = p_event_id
         and (
           (e.visibility = 'public' and e.status = 'scheduled')
           or e.host_user_id = viewer
           or exists (
             select 1 from public.event_rsvps r
             where r.event_id = e.id and r.user_id = viewer
           )
           or exists (
             select 1 from public.event_invites i
             where i.event_id = e.id and i.invited_user_id = viewer
           )
           or exists (
             select 1 from public.event_attendee_imports ei
             where ei.event_id = e.id and ei.claimed_by_user_id = viewer
           )
         )
     );
$$;

comment on function private.can_see_event(uuid, uuid) is
  'Whether viewer may see event p_event_id: public+scheduled, host, RSVPd, '
  'invited, or a claimed guest-list attendee (added 20260903150000 — see '
  'that migration''s header for the bug this closes). Used by the RSVP '
  'write path, event-cover storage policy, and event_attendance_counts; '
  'NOT by the events table''s own SELECT policy, which is deliberately '
  'inlined instead (20260901120000''s self-reference fix) and carries the '
  'identical branches by hand.';

drop policy "read public events, your own, and ones you are on the list for" on public.events;
create policy "read public events, your own, and ones you are on the list for"
on public.events for select to authenticated
using (
  (visibility = 'public' and status = 'scheduled')
  or host_user_id = (select private.current_user_id())
  or exists (
    select 1 from public.event_rsvps r
    where r.event_id = events.id and r.user_id = (select private.current_user_id())
  )
  or exists (
    select 1 from public.event_invites i
    where i.event_id = events.id and i.invited_user_id = (select private.current_user_id())
  )
  or private.has_claimed_import_for_event(events.id)
);
