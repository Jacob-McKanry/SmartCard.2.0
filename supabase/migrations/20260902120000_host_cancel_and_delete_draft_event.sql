-- =============================================================================
-- 20260902120000_host_cancel_and_delete_draft_event.sql
--
-- WHAT THIS CHANGES
--   Adds `public.cancel_event(uuid)` and `public.delete_draft_event(uuid)`.
--   Widens `events_cancelled_reason_check` to admit a second value,
--   `'host_cancelled'`, alongside the existing `'host_account_deleted'`.
--   No table is created, no column added, no existing grant changed.
--
-- WHY THIS EXISTS
--   Owner request, 2026-09-02: a host has had no way to remove an event since
--   events shipped. `eventCancelReasonSchema`'s own comment
--   (`packages/types/src/db/enums.ts`) already named this gap: "this product
--   has no host-facing 'cancel my event' control... a host-facing cancel
--   control adds its own value here and to the CHECK in 20260815130100."
--
-- ===========================================================================
-- TWO DIFFERENT OPERATIONS, BECAUSE "DELETE" MEANS SOMETHING DIFFERENT
-- DEPENDING ON WHETHER ANYONE ELSE HAS SEEN THE EVENT
-- ===========================================================================
--   A LIVE (`scheduled`) event can have real people depending on it —
--   `event_rsvps` and `event_invites` rows that are `on delete cascade`
--   against `events`. A true DELETE would silently destroy their RSVP
--   history and invite records along with the event, which is the exact
--   outcome this codebase already decided against for the OTHER path that
--   removes an event: `docs/architecture/2026-08-09-initial-architecture-
--   proposal.md`'s Q5 amendment quotes the reasoning in full, and
--   `removal-copy.ts`'s header restates it — "the whole reason a cancelled
--   event stays visible is that 'the event vanished' is a worse outcome for
--   the people who answered than 'the event is cancelled'." `cancel_event`
--   reuses that exact mechanism (`status -> 'cancelled'`) rather than
--   inventing a second one, so a host-cancelled event behaves identically to
--   an account-deletion-cancelled one everywhere else in the app:
--   `CancelledNotice`, the "Cancelled" badge, dropped from public browse,
--   still visible to the host and to everyone holding an RSVP or an invite.
--
--   A DRAFT has no such dependents by construction: `import_event_attendees`,
--   `list_own_import_links` and the `events` INSERT policy's own "scheduled
--   requires verified host" branch (20260901130000) all require
--   `status = 'scheduled'`, and `request_event_rsvp`/invite-sending are
--   reachable on a draft only by its own host (nobody else can see it to
--   answer). Nothing of substance is lost by a real DELETE, and "delete a
--   draft" is the honest word for what happens — there is no "cancelled
--   draft" state anyone would ever need to see.
--
-- ===========================================================================
-- WHY EACH FUNCTION REQUIRES THE EXACT STARTING STATUS IT DOES
-- ===========================================================================
--   `cancel_event` requires `status = 'scheduled'`. Not `draft` — a host
--   deleting an unpublished draft should get `delete_draft_event`'s real
--   delete, not a cancelled row nobody will ever be shown. Not already
--   `cancelled` — recancelling is a no-op this function refuses rather than
--   silently allows, so a caller cannot use success/failure to distinguish
--   "was scheduled" from "was already cancelled" — same §3.6-style posture
--   every other RPC in this schema uses for a guessed or stale id.
--
--   `delete_draft_event` requires `status = 'draft'`, for the mirror reason:
--   a live event must go through `cancel_event` so the people who answered
--   keep seeing it, never through this function, which does not know how to
--   preserve anything.
--
--   Both refuse identically (`42501`) for "not your event", "no such event",
--   and "wrong current status" — the same indistinguishable-refusal shape
--   `publish_event` already established for the identical reason.
--
-- ===========================================================================
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
-- ===========================================================================
--   Grants: EXECUTE on both functions to `authenticated`. Each independently
--     re-derives host_user_id = caller from the row itself — there is no
--     shared "am I the host" check to get out of sync between them.
--   Forbids: nothing new. Neither function is reachable for an event the
--     caller does not host. `events` gets no new client-facing DELETE grant —
--     `delete_draft_event` deletes as the function's own privileges, exactly
--     as `soft_delete_own_account` already writes `events.status` without
--     `authenticated` ever holding an UPDATE grant on that column.
-- =============================================================================

alter table public.events
  drop constraint events_cancelled_reason_check;

alter table public.events
  add constraint events_cancelled_reason_check
  check (cancelled_reason is null or cancelled_reason in ('host_account_deleted', 'host_cancelled'));

comment on column public.events.cancelled_reason is
  'Why a cancelled event was cancelled: host_account_deleted (the ONLY value '
  'public.restore_deleted_user re-schedules — see its own header) or '
  'host_cancelled (20260902120000, from public.cancel_event, and permanent: '
  'there is no un-cancel path for it).';

-- ---------------------------------------------------------------------------
-- public.cancel_event — the host-facing counterpart to
-- soft_delete_own_account's bulk cancellation
-- ---------------------------------------------------------------------------
create or replace function public.cancel_event(p_event_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
begin
  if v_user is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.events
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_reason = 'host_cancelled'
   where id = p_event_id
     and host_user_id = v_user
     and status = 'scheduled';

  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;

comment on function public.cancel_event(uuid) is
  'Cancels ONE live event. Host-only, and only from scheduled — refuses '
  'identically for "not your event", "no such event", and "already '
  'cancelled", so a guessed id cannot be used to probe which is true. Uses '
  'the same status/cancelled_at/cancelled_reason mechanism '
  'soft_delete_own_account already writes, so a host-cancelled event behaves '
  'identically everywhere else in the app to an account-deletion-cancelled '
  'one: visible to its host and everyone holding an RSVP or an invite, '
  'dropped from public browse. Permanent — there is no un-cancel RPC for '
  'cancelled_reason = ''host_cancelled''.';

revoke all on function public.cancel_event(uuid) from public, anon;
grant execute on function public.cancel_event(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.delete_draft_event — a real delete, for the one case nothing is lost
-- ---------------------------------------------------------------------------
create or replace function public.delete_draft_event(p_event_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
begin
  if v_user is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from public.events
   where id = p_event_id
     and host_user_id = v_user
     and status = 'draft';

  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;

comment on function public.delete_draft_event(uuid) is
  'Permanently deletes ONE draft event. Host-only, and only from draft — a '
  'live event must go through cancel_event instead, which preserves the '
  'record for anyone who already answered; this function does not know how '
  'to. Refuses identically for "not your event", "no such event", and "not a '
  'draft" (including an already-cancelled or already-published event), so a '
  'guessed id cannot be used to probe which is true. Cascades to that event''s '
  'own event_rsvps/event_invites/event_attendee_imports rows by the existing '
  'FK constraints — expected to be none, since every write path into those '
  'tables already requires status = ''scheduled''.';

revoke all on function public.delete_draft_event(uuid) from public, anon;
grant execute on function public.delete_draft_event(uuid) to authenticated;
