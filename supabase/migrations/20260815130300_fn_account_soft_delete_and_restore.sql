-- =============================================================================
-- 20260815130300_fn_account_soft_delete_and_restore.sql
--
-- WHAT THIS CHANGES
--   Adds the two functions that make self-serve account deletion real, and the
--   grants that decide who may call each:
--
--     public.soft_delete_own_account()        -- the member, on themselves
--     public.restore_deleted_user(uuid)       -- an operator, on anybody
--
--   Nothing else. No column, no policy, no table.
--
-- ===========================================================================
-- WHY THIS IS ONE DATABASE FUNCTION AND NOT FOUR SEQUENTIAL API CALLS
-- ===========================================================================
--   The same reason `create_verified_connection` is one
--   (20260813210300), and it is worth restating because the partial states here
--   are security-relevant rather than untidy. supabase-js has no client-side
--   multi-statement transaction: four PostgREST calls are four independent
--   transactions, and any one of them can be the last that runs. What that
--   produces:
--
--     * user marked deleted, CARDS NOT REVOKED -> the person is gone from the
--       product and their physical card still resolves `/card/<code>` to their
--       phone number and email address, permanently, to anybody holding it.
--       That is the single worst outcome this feature can have, and it is the
--       one a dropped connection would produce by default.
--     * user marked deleted, SESSION NOT REVOKED -> a QR code they had on screen
--       when they tapped Delete keeps resolving `/c/<token>` to the same
--       details for the rest of the session's life.
--     * cards revoked, USER NOT MARKED DELETED -> they are still listed
--         everywhere, still readable, and have silently lost their cards.
--     * user marked deleted, EVENTS NOT CANCELLED -> events with a host who no
--       longer exists stay on browse looking live, and their approval queues
--       have nobody who can answer them.
--
--   A `plpgsql` function runs inside one transaction by construction, so every
--   statement below commits together or none of them does. "Fail closed"
--   (CLAUDE.md) on this path means exactly that: an interrupted delete changes
--   nothing at all and the person can try again, rather than leaving an account
--   in a state that is neither present nor gone.
--
-- ===========================================================================
-- WHY `soft_delete_own_account` IS `security definer`, AND WHY IT TAKES NO
-- ARGUMENTS
-- ===========================================================================
--   It is the same call 20260814051200 made for the RSVP write path, and the
--   opposite of the call 20260813210300 made for the atomic connect commit. The
--   deciding question is who the intended caller is.
--
--   The intended caller here is `authenticated` — a person deleting their own
--   account from Settings — and `authenticated` holds no UPDATE grant on
--   `users.status`, none on `users.deleted_at`, and none on `events.status`.
--   That is deliberate and stays true: 20260809211100 excludes `status` from the
--   `users` column grant so "a user must not un-suspend themselves", and
--   20260815130100 leaves the new event columns out of the `events` grant so a
--   client cannot cancel anything. An invoker-rights function could therefore
--   not do the job, and the answer is NOT to widen those grants — a grant is
--   available to every request the client can make, forever, while a definer
--   function is available only in the shape its body allows.
--
--   The safety property comes from the same place the RSVP functions get it:
--   **this function takes no actor as a parameter.** The subject is
--   `private.current_user_id()`, read from the JWT inside the body. There is no
--   argument any caller can pass that makes it act on somebody else, which is
--   what keeps "definer rights" from meaning "impersonation". It is not possible
--   to call this function and delete another person's account, however the call
--   is constructed, because the account is not something the call names.
--
--   `set search_path = ''` on both functions, for 20260809210900's reason: a
--   definer function with an inherited search_path can be hijacked into running
--   somebody else's code with the owner's rights. Every reference below is
--   schema-qualified.
--
-- WHY IT RETURNS A REASON INSTEAD OF RAISING
--   Same choice as every other write path in this schema. A refusal is an
--   ordinary answer the service layer can turn into a sentence, and — the
--   sharper reason — a raise would roll back the transaction, which on this path
--   is the correct behaviour for a FAILURE and the wrong behaviour for a
--   REFUSAL. Genuinely unexpected states still raise, and still roll back.
--
-- ===========================================================================
-- EXACTLY WHAT A DELETE CHANGES, AND WHAT IT DELIBERATELY DOES NOT
-- ===========================================================================
--   CHANGES, in one transaction:
--     users             status -> 'deleted', deleted_at -> now()
--     cards             every `assigned` card of theirs -> 'revoked'
--     events            every `scheduled` event they host -> 'cancelled',
--                       cancelled_reason 'host_account_deleted'
--     connection_sessions  every `active` session they are presenting -> 'revoked'
--
--   DOES NOT CHANGE, each for a stated reason:
--     connections       Left `active`. The `active -> removed` transition is
--                       one-way (20260809211200 refuses the reverse, because a
--                       restored edge would be a live connection with no fresh
--                       verification behind it). Removing edges here would make
--                       the delete irreversible in the dimension that matters
--                       most. The other party stops seeing the person because
--                       the `users` policy hides them (20260815130200), which is
--                       a reversible mechanism.
--     meetings, meeting_participants, meeting_locations
--                       Shared history involving somebody else, and the whole
--                       point of §4.7 threat 4 is that these tables have one
--                       writer. This is not it.
--     event_rsvps       Their own answers to other people's events, and other
--                       people's answers to theirs. See 20260815130100's
--                       judgment call on why a cancelled event's queue is closed
--                       rather than rewritten: writing `denied` on the waiting
--                       rows would record a host decision that never happened.
--     social_links, profile fields, the photo in Storage
--                       All still there, and that is what makes this a soft
--                       delete. Nothing reads them: the `users` row is hidden
--                       from every graph reader, and the card preview refuses a
--                       non-active owner before it reads anything else. If a
--                       hard delete is ever wanted it is a different operation
--                       with a different name, and it should be written as one.
--     is_admin          Untouched, so a restored administrator is restored
--                       whole. There is no admin surface in this product for the
--                       flag to be dangerous on while the account is deleted,
--                       and the account cannot hold a session in any case.
--
--   A NOTE ON WHY AN ADMIN SELF-DELETE IS NOT REFUSED. It was considered — "the
--   last administrator deletes themselves and nobody can undo it" is the obvious
--   worry. It does not apply: restoration is a `service_role` operation
--   (below), not an in-app admin one, so an operator with database access can
--   always reverse this regardless of who is left holding `is_admin`. Refusing
--   would guard a capability that does not exist and would put an error in front
--   of a person for a reason the UI could not honestly explain.
--
-- ===========================================================================
-- WHAT `restore_deleted_user` PUTS BACK, AND THE ONE THING IT WILL NOT
-- ===========================================================================
--   PUTS BACK:
--     users     status -> 'active', deleted_at -> null. The account can hold a
--               session again the moment this commits — `ensureUser()` gates on
--               exactly this column.
--     events    every event of theirs cancelled BY THIS DELETION
--               (`cancelled_reason = 'host_account_deleted'`) -> 'scheduled',
--               with `cancelled_at` and `cancelled_reason` cleared. Events a
--               host had cancelled for their own reasons are left cancelled,
--               which is what the reason column exists for (20260815130100).
--
--   DOES NOT PUT BACK — cards. This is the asymmetry in this file and it is
--   deliberate, not an omission. `cards.status` records no reason, so the
--   database genuinely cannot tell a card revoked by this deletion from one the
--   owner revoked last month because they lost it, and un-revoking that card
--   would re-arm a credential somebody else is physically holding. Guessing in
--   the direction of "re-enable everything" on a security kill switch is not an
--   acceptable trade for saving one tap. It costs nothing, because un-revoking
--   is a capability the owner already has: 20260809211100 grants
--   `update (status)` on their own card with a WITH CHECK confining it to
--   `assigned` or `revoked`, and `/activity` renders the control. A restored
--   member re-enables their own cards, deliberately, having looked at the tap
--   log next to the button. The restore's return value reports how many cards
--   are sitting revoked so an operator can tell them.
--
-- ===========================================================================
-- ACCESS GRANTED / FORBIDDEN
-- ===========================================================================
--   public.soft_delete_own_account()
--     EXECUTE revoked from PUBLIC and `anon`; GRANTED to `authenticated`.
--     `anon` cannot reach it (no grant, and `current_user_id()` would be null
--     anyway, which the first branch refuses). An `authenticated` caller can
--     delete exactly one account: their own, because that is the only one the
--     function can name.
--
--   public.restore_deleted_user(uuid)
--     EXECUTE revoked from PUBLIC, `anon` and `authenticated`; GRANTED to
--     `service_role` alone. `security invoker`, following
--     `create_verified_connection`'s reasoning: the only intended caller already
--     bypasses RLS, so definer rights would buy nothing and would turn a
--     mistaken `grant execute ... to authenticated` into a capability to
--     resurrect arbitrary accounts. As invoker, that same mistaken grant lands
--     on a role holding no UPDATE privilege on `users.status` or `events.status`
--     and the first statement fails.
--
--     There is no in-app caller. Restoration is an operator action taken with
--     the service role, and building a screen for it would mean building an
--     admin surface this product does not have. The function exists so that
--     "reversible by an administrator" is a specified, single-statement
--     operation rather than a sentence in a confirmation dialog that somebody
--     would later have to reverse-engineer by hand.
--
-- WHY BOTH FUNCTIONS TAKE THE USER ROW LOCK FIRST
--   `select ... for update` on the `users` row before anything is written. Two
--   concurrent delete requests (a double-tapped button is enough) serialise
--   there, and the second one sees `status = 'deleted'` and returns the
--   already-deleted answer instead of re-running four updates against a
--   half-visible state. The same compare-under-lock discipline
--   `request_event_rsvp` uses for capacity.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- public.soft_delete_own_account
-- ---------------------------------------------------------------------------
create or replace function public.soft_delete_own_account()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_now timestamptz := now();
  v_status text;
  v_cards_revoked integer := 0;
  v_events_cancelled integer := 0;
  v_sessions_revoked integer := 0;
begin
  -- No JWT, or a request that never went through the token exchange. Fails
  -- closed like every §3.1 helper.
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select u.status into v_status
  from public.users u
  where u.id = v_user
  for update;

  if not found then
    -- A valid JWT naming a row that does not exist. Not a case that should
    -- occur — `ensureUser()` mints the token from the row — so it refuses
    -- rather than guessing.
    return jsonb_build_object('ok', false, 'reason', 'user_not_found');
  end if;

  if v_status = 'deleted' then
    -- Idempotent, and reported as such rather than as a failure: the caller's
    -- intent has already been satisfied, and the UI's next step (sign out) is
    -- the same either way. Nothing is re-written, so a double submit cannot
    -- re-cancel an event an operator has since restored.
    return jsonb_build_object('ok', true, 'already_deleted', true);
  end if;

  if v_status <> 'active' then
    -- `suspended`. Unreachable today (a suspended account cannot obtain a
    -- Supabase JWT, so it cannot call this), and refused explicitly anyway:
    -- letting somebody under an administrative hold convert it into a state the
    -- hold no longer describes is not a decision this function should make.
    return jsonb_build_object('ok', false, 'reason', 'account_not_active');
  end if;

  -- 1. The account itself.
  update public.users u
     set status = 'deleted',
         deleted_at = v_now,
         updated_at = v_now
   where u.id = v_user;

  -- 2. Cards. Immediately, and in this transaction, because a card that still
  --    resolves after deletion defeats the point of deleting: `/card/<code>` is
  --    a permanent URL printed on a physical object, and it answers with a phone
  --    number and an email address. `assigned` only: a card already `revoked` has
  --    nothing to do to it, and `unassigned` stock has no owner to match.
  update public.cards c
     set status = 'revoked'
   where c.owner_user_id = v_user
     and c.status = 'assigned';
  get diagnostics v_cards_revoked = row_count;

  -- 3. Events they host. Cancelled, never deleted: attendees keep seeing the
  --    event and read "Cancelled" on it, which is the whole point of the state.
  --    `scheduled` only, so an event the host had already cancelled keeps its
  --    original reason and is not claimed by this deletion — which is what makes
  --    `restore_deleted_user` able to be precise.
  update public.events e
     set status = 'cancelled',
         cancelled_at = v_now,
         cancelled_reason = 'host_account_deleted'
   where e.host_user_id = v_user
     and e.status = 'scheduled';
  get diagnostics v_events_cancelled = row_count;

  -- 4. Live presentation sessions. Same argument as the cards, one surface over:
  --    a QR code on screen at the moment of deletion mints tokens that resolve
  --    `/c/<token>` to the same contact details for the rest of the session's
  --    life. `revoked` is the existing burn state for a session
  --    (20260809210400); it is what the five-failure rule already writes, and
  --    `card-preview-service.ts` and both verifiers already refuse anything that
  --    is not `active`.
  update public.connection_sessions s
     set status = 'revoked'
   where s.presenter_user_id = v_user
     and s.status = 'active';
  get diagnostics v_sessions_revoked = row_count;

  return jsonb_build_object(
    'ok', true,
    'already_deleted', false,
    'cards_revoked', v_cards_revoked,
    'events_cancelled', v_events_cancelled,
    'sessions_revoked', v_sessions_revoked
  );
end;
$$;

comment on function public.soft_delete_own_account() is
  'Soft-deletes the CALLING account and, in the same transaction, revokes its '
  'cards, cancels the events it hosts and burns its live presentation sessions. '
  'Takes no arguments on purpose: the subject is read from the JWT, so no caller '
  'can name somebody else. Reversible by public.restore_deleted_user, which is '
  'service_role only. Returns {ok:false, reason} for a refusal; a failure rolls '
  'the whole thing back and changes nothing.';

revoke all on function public.soft_delete_own_account() from public, anon;
grant execute on function public.soft_delete_own_account() to authenticated;

-- ---------------------------------------------------------------------------
-- public.restore_deleted_user
-- ---------------------------------------------------------------------------
create or replace function public.restore_deleted_user(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_status text;
  v_events_restored integer := 0;
  v_cards_left_revoked integer := 0;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_user');
  end if;

  select u.status into v_status
  from public.users u
  where u.id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'user_not_found');
  end if;

  if v_status <> 'deleted' then
    -- Refused rather than treated as a no-op, because the two states this could
    -- be in mean very different things: `active` means somebody already
    -- restored it, and `suspended` means an administrator is deliberately
    -- holding it — quietly flipping that to `active` would undo a moderation
    -- decision from inside a function whose name says "restore a deletion".
    return jsonb_build_object('ok', false, 'reason', 'not_deleted', 'status', v_status);
  end if;

  update public.users u
     set status = 'active',
         deleted_at = null,
         updated_at = v_now
   where u.id = p_user_id;

  -- Only the events THIS deletion cancelled. See the header: the reason column
  -- is what stops a restore resurrecting an event its host had deliberately
  -- called off.
  update public.events e
     set status = 'scheduled',
         cancelled_at = null,
         cancelled_reason = null
   where e.host_user_id = p_user_id
     and e.status = 'cancelled'
     and e.cancelled_reason = 'host_account_deleted';
  get diagnostics v_events_restored = row_count;

  -- Counted, not changed. The header explains why re-arming a revoked card
  -- cannot be automatic; reporting the number is how the operator knows to tell
  -- the person there is something waiting for them on /activity.
  select count(*) into v_cards_left_revoked
  from public.cards c
  where c.owner_user_id = p_user_id
    and c.status = 'revoked';

  return jsonb_build_object(
    'ok', true,
    'events_restored', v_events_restored,
    'cards_left_revoked', v_cards_left_revoked
  );
end;
$$;

comment on function public.restore_deleted_user(uuid) is
  'Reverses a soft delete: the account becomes active again and the events that '
  'deletion cancelled become scheduled again. Cards are deliberately NOT '
  're-armed — the database cannot tell a card revoked by the deletion from one '
  'the owner revoked because they lost it — so the count still revoked is '
  'returned instead, and the owner re-enables them from /activity. service_role '
  'only; there is no in-app caller and no admin screen.';

revoke all on function public.restore_deleted_user(uuid) from public, anon, authenticated;
grant execute on function public.restore_deleted_user(uuid) to service_role;
