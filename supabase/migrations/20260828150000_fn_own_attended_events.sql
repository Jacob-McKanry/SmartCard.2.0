-- =============================================================================
-- 20260828150000_fn_own_attended_events.sql
--
-- WHAT THIS CHANGES
--   Adds `public.own_attended_events()` — §3.8's fifth and final RPC for
--   `event_attendee_imports`, and C5 of the 2026-08-22 attendee-import design
--   (§4.3, "the event page... plus 'You attended this.'"). No table changes,
--   no changes to any existing function.
--
-- WHY THIS EXISTS
--   `claim_event_import` (20260828130000) is, per §2.2, the last time a
--   claimed row holds anything about the person EXCEPT
--   `(event_id, claimed_by_user_id, claimed_at)` — deliberately kept because
--   it "is the attendance fact, it is about a consenting user, and it is
--   what powers 'events you have attended.'" Nothing has read it back until
--   now. `event_attendee_imports` has RLS enabled and forced with zero
--   policies (20260827130000), so — same as every other read of this table —
--   the only way in is a `security definer` function that checks something
--   first.
--
-- WHY THIS ONE NEEDS NO RATE LIMIT, UNLIKE ITS FOUR SIBLINGS
--   `get_claimable_import` and `claim_event_import` both take an argument a
--   caller controls (a token) and both answer a question that could be
--   probed against SOMEBODY ELSE'S row — that is exactly what §3.6/§3.7 rate-
--   limit and collapse to one shape. `own_attended_events()` takes no
--   argument at all: `private.current_user_id()` is the only input, it comes
--   from the caller's own verified session, and the answer is a fact about
--   the CALLER's own claimed rows. There is no other identity to probe for
--   and no way to point this function at anybody else's data, so the whole
--   category of attack the other four RPCs defend against does not apply
--   here — same reasoning `own_rsvp`-style reads elsewhere in this schema
--   never carry a rate limit either.
--
-- WHY NO WHERE CLAUSE ON `expires_at`
--   `expires_at` (§2.3) governs how long an UNCLAIMED row's PII survives
--   before the (not-yet-built) purge job removes it. A claimed row has
--   already had its PII destroyed (§2.2) and is not what that column is
--   about — the attendance fact itself does not expire. Filtering on
--   `claimed_at is not null` is what selects "a claim actually happened";
--   `expires_at` is irrelevant to a claimed row and is not read here.
-- =============================================================================

create or replace function public.own_attended_events()
returns table (event_id uuid, claimed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select event_id, claimed_at
    from public.event_attendee_imports
   where claimed_by_user_id = private.current_user_id()
     and claimed_at is not null
   order by claimed_at desc;
$$;

comment on function public.own_attended_events() is
  'The caller''s own claimed guest-list rows (§3.8/§4.3 of the 2026-08-22 '
  'attendee-import design) — event_id and claimed_at only, the two fields '
  '§2.2''s destroy-on-claim UPDATE leaves behind. Takes no argument and reads '
  'only private.current_user_id(), so — unlike get_claimable_import and '
  'claim_event_import — there is no other caller''s row this function can be '
  'pointed at and no rate limit is needed. A caller with no session gets zero '
  'rows: current_user_id() is null, and no row''s claimed_by_user_id can '
  'equal null.';

revoke all on function public.own_attended_events() from public, anon;
grant execute on function public.own_attended_events() to authenticated;
