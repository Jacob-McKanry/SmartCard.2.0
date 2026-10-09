-- =============================================================================
-- 20261009140200_block_filter_feed_meetings.sql
--
-- THIS IS THE SAME DELIBERATE AMENDMENT, APPLIED TO THE FEED.
--   20260809211100: "if the answer is yes and blocking should also hide
--   profiles, that is a deliberate amendment to this policy, not something to
--   slip in here." Q4 is answered yes, with blocking applied to "the app's
--   existing feed/roster/profile read paths" (owner decision 4,
--   `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`). This file
--   is the feed's share of that amendment; 20261009140000 (profiles/photos)
--   and 20261009140100 (roster) are the other two. Part 5 of 5 of the
--   amendment's Phase 2.
--
-- WHAT THIS CHANGES
--   `private.can_see_meeting(viewer, meeting)` — the rule behind both the
--   `meetings` and `meeting_participants` SELECT policies, i.e. behind the
--   triadic "A met B" feed post — gains, on PATH B ONLY (the mutuals-of-both
--   branch), the requirement that the viewer has no block in either
--   direction with EITHER party:
--
--     and not private.blocked_either_way(viewer, meeting_party(m, 1))
--     and not private.blocked_either_way(viewer, meeting_party(m, 2))
--
--   PATH A — "you were there" — is untouched. It is this function's self
--   branch: privacy controls (and now blocks) exist to limit third parties,
--   never to hide a meeting from the people who had it. A person who blocks
--   someone they met still sees that the meeting happened, in their own
--   history.
--
-- WHY THIS IS MOSTLY BELT-AND-BRACES, STATED HONESTLY
--   Path B already requires the viewer to hold an ACTIVE connection to both
--   parties (`is_mutual_of_both`), and a blocked pair cannot hold one:
--   `block_user` removes it in the same transaction (20261009130000), and
--   `create_verified_connection` / `create_manual_connection` both refuse a
--   blocked pair. So on today's write paths this condition can only change
--   the answer if some future path lets an active connection coexist with a
--   block. It is added anyway because the owner's decision was that blocks
--   apply to the feed, and a rule that holds only because two other functions
--   happen to cooperate is the kind of invariant this schema states directly
--   instead (the same reasoning 20260809210600 gives for enforcing the
--   ordered-pair rule in the table rather than in application code).
--
-- WHAT IT DOES NOT DO — A QUESTION LEFT OPEN, NOT DECIDED HERE
--   It does not hide a meeting from third parties when the two PARTICIPANTS
--   have blocked each other (A met B, later A blocked B; C, a mutual of both,
--   can still see "A met B" if C is still connected to both). The phase brief
--   scopes this filter to the viewer's own blocks, and whether a block between
--   two people should also retract their shared history from mutual friends'
--   feeds is a product decision with its own trade-offs (it would let either
--   participant unilaterally erase a shared record from others' view). Flagged
--   in the Phase 2 report for the owner rather than chosen here.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: nothing. EXECUTE on `can_see_meeting` is unchanged.
--   Forbids, newly, to every `authenticated` caller: seeing a meeting (and its
--     participant rows) through the mutuals branch when the viewer and either
--     participant have blocked each other in either direction.
--   Unchanged: participants always see their own meetings;
--     `meeting_locations` keeps its own stricter policy (see 20261009140000's
--     note on why it is not touched).
-- =============================================================================

create or replace function private.can_see_meeting(viewer uuid, p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select viewer is not null
     and p_meeting_id is not null
     and (
       exists (
         select 1
         from public.meeting_participants mp
         where mp.meeting_id = p_meeting_id
           and mp.user_id = viewer
       )
       or (
         exists (
           select 1
           from public.meetings m
           where m.id = p_meeting_id
             and m.is_private = false
         )
         and not exists (
           select 1
           from public.meeting_participants mp
           where mp.meeting_id = p_meeting_id
             and mp.marked_private = true
         )
         and private.is_mutual_of_both(
               viewer,
               private.meeting_party(p_meeting_id, 1),
               private.meeting_party(p_meeting_id, 2))
         -- Amended 20261009140200 (the deliberate block-filtering amendment).
         -- Path B only; path A ("you were there") above is untouched.
         -- `blocked_either_way` answers true for a null party, so a malformed
         -- meeting still fails closed here exactly as is_mutual_of_both does.
         and not private.blocked_either_way(viewer, private.meeting_party(p_meeting_id, 1))
         and not private.blocked_either_way(viewer, private.meeting_party(p_meeting_id, 2))
       )
     );
$$;

comment on function private.can_see_meeting(uuid, uuid) is
  'Whether a viewer may see that a meeting happened: participants always, plus '
  'mutuals of both parties when nobody has marked it private and the viewer has '
  'no block in either direction with either party (20261009140200). Says '
  'nothing about the meeting''s location — that is a separate, stricter test (§3.2).';
