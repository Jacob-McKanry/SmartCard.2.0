-- =============================================================================
-- 20260815130100_table_event_cancellation_and_account_deletion.sql
--
-- WHAT THIS CHANGES
--   The schema half of self-serve account deletion. Columns and one integrity
--   trigger; no policies, no grants, no functions that anybody calls — those are
--   in 20260815130200 and 20260815130300, kept separate so the "what exists"
--   review and the "who may touch it" review are separate reads, the same split
--   20260814051000 used.
--
--     1. `events.status`, `events.cancelled_at`, `events.cancelled_reason` —
--        an event can now be cancelled without being deleted.
--     2. `users.deleted_at` — when a soft delete happened.
--     3. A BEFORE INSERT OR UPDATE trigger on `event_rsvps` refusing any write
--        against a cancelled event.
--
-- WHY EVENTS NEED A CANCELLED STATE AT ALL
--   Because a person deleting their account may be hosting events other people
--   have already answered for, and neither of the two obvious options is
--   acceptable:
--
--     * Delete the events. `events` has no DELETE policy for anybody and
--       20260809211300 says why — "an event other people RSVP'd to and met at is
--       shared history". Deleting also cascades `event_rsvps` away, so the
--       attendees' own answers vanish with it.
--     * Leave them alone. Then an event with no host and no chance of happening
--       stays on the browse screen and in people's attending lists, indefinitely,
--       looking live. Somebody turns up.
--
--   The project owner's decision is the third option: cancel them, and keep them
--   visible to the people who already answered so that an event they were
--   counting on does not silently vanish. This migration is the state that makes
--   that possible; 20260815130200 is the visibility rule.
--
-- WHY `status` AND NOT A `cancelled boolean`
--   Convention, and headroom. Every other lifecycle field in this schema is
--   `text` + CHECK (`users.status`, `cards.status`, `connections.status`,
--   `event_rsvps.status`) for the reason §2.1 gives: adding a value later is a
--   one-line migration instead of a type rewrite. `postponed` and `draft` are
--   both plausible future states for an event and neither fits a boolean.
--   Default `scheduled` — every existing row is an ordinary event, and no
--   backfill is needed because the default applies to them.
--
-- WHY THERE IS A `cancelled_reason` COLUMN WHEN THERE IS ONLY ONE REASON TODAY
--   This is the column that makes the soft delete genuinely REVERSIBLE, which is
--   the whole difference between a soft delete and a slow hard one.
--
--   When an administrator restores a deleted account, the events cancelled *by
--   that deletion* should come back — and the events the host had already
--   cancelled themselves should not. Without a recorded reason, a restore has to
--   guess, and both guesses are wrong in an obvious way: un-cancel everything and
--   you resurrect an event the host deliberately called off; un-cancel nothing
--   and the restore is not a restore. One text column removes the guess entirely,
--   and `public.restore_deleted_user` (20260815130300) filters on it.
--
--   The CHECK lists exactly one value today because there is exactly one writer
--   today: there is no host-facing "cancel my event" control anywhere in this
--   product. When one is built it adds `host_cancelled` to this CHECK, and the
--   restore path keeps working unchanged because it names the value it owns
--   rather than testing for "cancelled at all".
--
-- WHY `users.deleted_at` AND NOT JUST `status = 'deleted'`
--   "When" is the first question an administrator asks before reversing
--   something, and `status` cannot answer it. It is nullable and stays null for
--   `suspended` accounts: suspension predates this work, is an administrative
--   hold with its own (manual) lifecycle, and giving it a timestamp here would
--   imply a mechanism that does not exist. Cleared by the restore path, so a
--   restored account is indistinguishable from one that was never deleted —
--   which is what "reversible" has to mean.
--
-- THE COLUMN GRANTS ARE UNCHANGED, AND THAT IS LOAD-BEARING
--   `grant update (...) on public.events to authenticated` (20260809211300,
--   widened by 20260814051100) is a COLUMN LIST. Adding a column to a table does
--   not add it to a column-level grant, so `status`, `cancelled_at` and
--   `cancelled_reason` are unwritable by `authenticated` from the moment they
--   exist — a host cannot cancel their own event by talking to PostgREST, and
--   nobody can cancel anybody else's. The only writer is
--   `public.soft_delete_own_account()` in 20260815130300. Same for
--   `users.deleted_at`, which is not in that table's UPDATE grant either.
--   If a host-facing cancel control is ever built, widening the grant is the
--   deliberate act that enables it, and it should be reviewed as one.
--
-- JUDGMENT CALLS RECORDED HERE (per §3.6's convention)
--
--   Cancelling does NOT touch `event_rsvps` rows.
--     The tempting move is to resolve the host's pending-approval queue by
--     writing `denied` on every waiting row, so nobody is left waiting on a host
--     who no longer exists. It was rejected because it would be a lie in the
--     database: `denied` means "the host decided you may not come"
--     (20260814051000's column comment), and nobody decided anything — the event
--     was called off. `not_going` would be a worse lie, since it attributes a
--     choice to the requester. Adding a seventh RSVP status for it was weighed
--     and rejected too: `event_rsvps.status` feeds `private.shares_event_with()`
--     and therefore the `users` read policy, so widening that set is an
--     access-control change, and it would be one made to describe a fact that is
--     already recorded on the event row.
--
--     The queue is closed instead of rewritten — see the trigger below. Nothing
--     can join it, nothing can be decided in it, and every screen that shows an
--     RSVP for a cancelled event reads the event's own status and says
--     "Cancelled" rather than "Waiting on the host". The person's row is left
--     telling the truth about what they asked for.
--
--   The trigger refuses rather than silently ignoring.
--     Fail closed (CLAUDE.md). A write against a cancelled event is either a UI
--     that has not noticed, or a caller going around the UI; both should get an
--     error rather than a success that did nothing.
--
--   DELETE from `event_rsvps` is deliberately still allowed on a cancelled
--   event.
--     `public.withdraw_event_rsvp` must keep working. Withdrawing "only ever
--     reduces what anyone can see about you" (20260814051200), so there is no
--     version of it that needs to fail closed, and trapping people inside a
--     cancelled event's roster would be a strange thing to do to them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- events — the cancelled state
-- ---------------------------------------------------------------------------
alter table public.events
  add column status text not null default 'scheduled'
    check (status in ('scheduled', 'cancelled')),
  add column cancelled_at timestamptz,
  add column cancelled_reason text
    check (cancelled_reason is null or cancelled_reason in ('host_account_deleted')),

  -- The three columns describe one fact, so they are constrained to agree.
  -- Without this, `status = 'cancelled'` with a null reason is a row the restore
  -- path cannot classify, and `cancelled_reason` set on a `scheduled` row is a
  -- half-applied cancellation that every query would read as live.
  add constraint events_cancellation_is_complete check (
    (status = 'cancelled' and cancelled_at is not null and cancelled_reason is not null)
    or (status = 'scheduled' and cancelled_at is null and cancelled_reason is null)
  );

comment on column public.events.status is
  'scheduled | cancelled. A cancelled event is never deleted — it stays readable '
  'to the host and to everyone who already has an RSVP row, so an event somebody '
  'was counting on does not silently vanish, and it drops out of the public '
  'browse branch of private.can_see_event (20260815130200). Not in the '
  'column-level UPDATE grant: clients cannot cancel anything.';

comment on column public.events.cancelled_at is
  'When the event was cancelled. Null exactly when status = ''scheduled'', by CHECK.';

comment on column public.events.cancelled_reason is
  'Why the event was cancelled. Today the only value is ''host_account_deleted'', '
  'written by public.soft_delete_own_account(). It exists so that restoring a '
  'deleted account can un-cancel the events THAT deletion cancelled without also '
  'resurrecting events a host had deliberately called off — see 20260815130300. '
  'A future host-facing cancel control adds its own value to the CHECK.';

-- Browse and the restore path both ask "which of this host's events are
-- cancelled, and why". Partial, because the overwhelming majority of rows are
-- `scheduled` and an index over those would be dead weight.
create index events_cancelled_host_idx
  on public.events (host_user_id, cancelled_reason)
  where status = 'cancelled';

-- ---------------------------------------------------------------------------
-- users — when the soft delete happened
-- ---------------------------------------------------------------------------
alter table public.users
  add column deleted_at timestamptz;

comment on column public.users.deleted_at is
  'When this account was soft-deleted, or null. Set together with '
  'status = ''deleted'' by public.soft_delete_own_account() and cleared by '
  'public.restore_deleted_user(), so a restored account is indistinguishable '
  'from one that was never deleted. Stays null for `suspended` accounts, whose '
  'hold is an administrative act with no mechanism here. Not in the '
  'column-level UPDATE grant.';

-- ---------------------------------------------------------------------------
-- event_rsvps — a cancelled event's queue is closed, not rewritten
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER RATHER THAN A CHECK INSIDE THE FOUR RSVP RPCS
--   The alternative was to `create or replace` `public.request_event_rsvp` and
--   `public.decide_event_rsvp` (20260814051200) with one extra branch each.
--   Rejected for two reasons, in this order:
--
--     1. `create or replace` on a plpgsql function means restating its ENTIRE
--        body. That is roughly two hundred lines of capacity, approval-gate and
--        waitlist logic re-transcribed to add two `if` statements, in a
--        migration that cannot be executed against a database during this build
--        — a transcription slip would not break cancellation, it would break
--        RSVPs for everyone. The smallest change that achieves the rule is the
--        correct one here.
--     2. A trigger covers every writer, including ones that do not exist yet.
--        The rule "you cannot join or be admitted to a cancelled event" is a
--        property of the table, not of the two functions that happen to write it
--        today, and stating it once at the table is what keeps a future write
--        path from having to remember.
--
--   What it costs, stated honestly: the RPCs answer refusals as
--   `{ok: false, reason: ...}` (20260814051200's header explains why), and a
--   trigger raises instead, so this one refusal arrives as an exception rather
--   than as a reason code. That is acceptable because the UI makes it
--   unreachable — every screen that can see a cancelled event renders no RSVP
--   control at all — so a caller who hits this went around the UI, and an error
--   is the right answer for them. If a reason code is ever wanted here, moving
--   the check into the RPCs is the change, and this trigger should be dropped in
--   the same migration rather than left as a second copy of the rule.
--
-- `security definer` for the reason every helper in `private` is: the function
-- reads `public.events`, which has FORCE ROW LEVEL SECURITY, and the answer must
-- not depend on whether the writing caller can see the event row.
-- `set search_path = ''` for 20260809210900's reason — a definer function with
-- an inherited path can be hijacked into running somebody else's code with the
-- owner's rights.
create or replace function private.refuse_rsvp_to_cancelled_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.events e
    where e.id = new.event_id
      and e.status = 'cancelled'
  ) then
    raise exception 'This event has been cancelled, so its guest list can no longer change.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function private.refuse_rsvp_to_cancelled_event() is
  'Refuses any INSERT or UPDATE on event_rsvps whose event is cancelled, so a '
  'cancelled event''s approval queue cannot grow and cannot be decided — there '
  'is nobody to decide it. DELETE is deliberately not covered: withdrawing an '
  'RSVP only ever reduces what is known about you, and must keep working.';

revoke all on function private.refuse_rsvp_to_cancelled_event() from public, anon, authenticated;

create trigger event_rsvps_refuse_when_event_cancelled
  before insert or update on public.event_rsvps
  for each row
  execute function private.refuse_rsvp_to_cancelled_event();
