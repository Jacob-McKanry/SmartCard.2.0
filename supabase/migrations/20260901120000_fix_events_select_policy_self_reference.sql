-- =============================================================================
-- 20260901120000_fix_events_select_policy_self_reference.sql
--
-- WHAT THIS CHANGES
--   Rewrites the `events` SELECT policy inline. `private.can_see_event(uuid,
--   uuid)` itself is UNCHANGED — every other caller (`request_event_rsvp`,
--   `event_rsvp_queue`, `decide_event_rsvp`) keeps using it exactly as before.
--   Only the policy expression on `events` itself stops calling it.
--
-- WHY THIS EXISTS — A REAL, LIVE BUG, FOUND BY REPRODUCING IT, NOT GUESSED
--   The owner reported "Something went wrong" creating an event, repeatedly,
--   including as recently as today. Production logs
--   (`postgres_logs`, `crpsbnbegeoqtlgshltt`) show the real error underneath
--   that generic message: `new row violates row-level security policy for
--   table "events"` — for a caller who unambiguously owned the row.
--
--   Reproduced directly against the live database in a rolled-back
--   transaction, as the real reporting account, with a real active city:
--   `insert into events (...) returning id` failed 42501 even though
--   `host_user_id` was that account's own id. The SAME insert with no
--   `RETURNING` clause succeeded. A follow-up `select` of the just-inserted
--   row, as a SEPARATE statement in the same transaction, also succeeded.
--   Only `INSERT ... RETURNING` — which `createEvent`'s
--   `.insert(...).select(...)` produces via PostgREST — failed.
--
--   Isolated the cause by substituting `select true` for the SELECT policy's
--   function call: that made `RETURNING` succeed, proving the policy's LOGIC
--   was never the problem. The actual policy
--   (`using ((select private.can_see_event(current_user_id(), events.id)))`)
--   asks `can_see_event` to independently RE-QUERY `public.events` BY ID
--   (`where e.id = p_event_id`) to re-derive facts (`status`, `host_user_id`,
--   `visibility`) that RLS already has bound to the exact row it is
--   evaluating. For an ordinary SELECT that is harmless — the row already
--   exists and the re-query sees it. For `INSERT ... RETURNING`, the row is
--   brand new within the SAME command, and the nested function's independent
--   re-query of the same table does not observe it, so the SELECT-for-
--   RETURNING check fails even though the WITH CHECK for the write itself
--   already passed moments earlier.
--
--   This is not new behaviour from any recent migration — reproduced with
--   plain `status = 'scheduled'`, the original, unmodified case that has
--   existed since events shipped (20260814051100). Every account that has
--   ever created an event through the web app's `createEvent` (which always
--   asks PostgREST to return the new row) has been exposed to this, and it is
--   the most likely explanation for "Something went wrong" reports on event
--   creation going back to when events launched.
--
-- ===========================================================================
-- WHY THE FIX IS "STOP RE-QUERYING THE ROW", NOT "MAKE THE FUNCTION SEE IT"
-- ===========================================================================
--   An RLS policy's `using` expression is evaluated once per row, with that
--   row's own columns already available and correct — `events.status`,
--   `events.visibility`, `events.host_user_id` are the values RLS is
--   currently deciding about, no lookup required. Calling a helper that goes
--   back to the table BY ID to re-derive the same three columns is strictly
--   worse than reading them directly: it is slower (a second scan per row),
--   and — this migration is why it matters — it is a real correctness bug
--   for exactly the write-then-return pattern this app's own service layer
--   uses everywhere.
--
--   `can_see_event(viewer, event_id)` keeps its by-id-lookup shape because
--   its OTHER callers genuinely need it that way: `request_event_rsvp` and
--   friends are checking visibility of an event ID supplied as an argument
--   while writing to a DIFFERENT table (`event_rsvps`), where there is no
--   "current row of events" already bound — a lookup is the only option
--   there, and it is not self-referential in the sense that broke this
--   policy. Only `events`' own policy had a row already in hand and was
--   throwing that away to look itself up again.
--
-- ===========================================================================
-- VERIFIED EQUIVALENT TO THE OLD POLICY, NOT JUST "NOW WORKS"
-- ===========================================================================
--   Every branch of the rewritten expression is copied verbatim from
--   `can_see_event`'s current body (20260830150000): public+scheduled,
--   host, RSVP holder, invite holder. Verified live in a rolled-back
--   transaction across every combination the old function distinguished —
--   see the commit message / PR for the full scenario list — before and
--   after this change, confirming identical SELECT visibility outcomes, on
--   top of the new INSERT...RETURNING regression tests this bug needed.
--
-- ===========================================================================
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
-- ===========================================================================
--   Grants: none. Forbids: none. This changes HOW the existing rule is
--   computed, not WHAT it permits — a public scheduled event, the host, an
--   RSVP holder, and an invite holder see a row exactly as before; everyone
--   else is refused exactly as before.
-- =============================================================================

drop policy "read public events, your own, and ones you are on the list for" on public.events;

create policy "read public events, your own, and ones you are on the list for"
on public.events for select to authenticated
using (
  (visibility = 'public' and status = 'scheduled')
  or host_user_id = (select private.current_user_id())
  or exists (
    select 1 from public.event_rsvps r
    where r.event_id = events.id
      and r.user_id = (select private.current_user_id())
  )
  or exists (
    select 1 from public.event_invites i
    where i.event_id = events.id
      and i.invited_user_id = (select private.current_user_id())
  )
);
