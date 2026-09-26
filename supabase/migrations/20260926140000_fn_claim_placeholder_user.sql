-- =============================================================================
-- 20260926140000_fn_claim_placeholder_user.sql
--
-- WHAT THIS CHANGES
--   Part 3 of the "unverified connections" amendment
--   (docs/architecture/2026-09-26-unverified-connections.md). Creates
--   `public.claim_placeholder_user(...)`, the single atomic function that
--   claims a `status = 'placeholder'` row (created by
--   `create_manual_connection`, 20260926130000) on a real Kinde signup.
--
-- WHY THIS IS ITS OWN FUNCTION, NOT TWO supabase-js CALLS FROM ensureUser()
--   `no-second-write-path.test.ts` enforces, across the whole repository,
--   that `users.status` is written from exactly one place —
--   `public.soft_delete_own_account()` — and states why: a direct
--   supabase-js `.update()` setting `status` would in fact fail at runtime
--   (the column is deliberately outside `users`' column-level UPDATE grant,
--   20260809211100: "a user must not un-suspend themselves"), and the failure
--   mode that discipline exists to prevent is a SELECT-then-UPDATE from
--   application code racing itself: two signups claiming the same
--   placeholder email at once could both read `status = 'placeholder'`
--   before either write lands, and — without a lock held across both steps —
--   both could believe they won the claim. Wrapping the whole thing in one
--   `plpgsql` function, exactly like every other status transition in this
--   schema, makes it atomic by construction rather than by care in the
--   caller.
--
-- WHY A SEPARATE FUNCTION RATHER THAN FOLDING THIS INTO
-- `create_manual_connection` OR INTO ANY EXISTING FUNCTION
--   This runs at a structurally different moment — real Kinde signup, called
--   from `ensureUser()`, the one place in this codebase that already holds
--   the service role specifically because "the identity is the thing being
--   established" (that file's own header). `create_manual_connection` runs
--   for an already-authenticated caller adding someone else. Merging the two
--   would mean a function serving two unrelated callers for two unrelated
--   reasons, which is exactly the shape `create_verified_connection`'s own
--   header argues against ("deliberately narrow").
--
-- WHAT IT DOES, IN ORDER
--   1. Locks and reads any `status = 'placeholder'` row matching the given
--      email (`for update`, so a concurrent claim attempt on the same row
--      waits rather than racing).
--   2. If none exists, returns `{claimed: false}` — `ensureUser()`'s signal
--      to fall through to its ordinary brand-new-row insert.
--   3. If one exists, updates it in place: `kinde_user_id` set,
--      `status` -> `'active'`, `email_verified` set from the fresh signup,
--      and `first_name`/`last_name` filled in ONLY where the placeholder had
--      none (`coalesce`) — the same "fill blanks, never overwrite" posture
--      `claim_event_import` already uses, so a name someone else typed in
--      while adding this placeholder is not silently discarded by a signup
--      that happens to omit one.
--   4. Returns `{claimed: true, id, status}` — the row's own id, unchanged,
--      so every `connections`/`meetings` row already pointing at it stays
--      valid.
--
-- ACCESS GRANTED / FORBIDDEN
--   EXECUTE revoked from PUBLIC, `anon` and `authenticated`; granted to
--   `service_role` alone. `security invoker` for the same reason
--   `create_verified_connection`/`create_manual_connection` both are: the
--   only caller is already the service role, so there is nothing for
--   `security definer` to buy here except turning a future mis-grant into a
--   free-standing capability to flip any row to `'active'` under any Kinde
--   id — invoker means that mis-grant would instead hit the absent UPDATE
--   grant on `users.status` and fail closed.
--
-- VERIFIED LIVE in a rolled-back transaction before applying: a placeholder
--   matching the given email is claimed in place (same id, status flips to
--   active, kinde_user_id set); a placeholder with an existing first/last
--   name keeps them when the signup supplies none, and a signup's own name
--   wins when it has one; no matching placeholder returns
--   `{claimed: false}` without touching any row; two concurrent claim
--   attempts against the same email serialize rather than double-claiming
--   (the second sees `status <> 'placeholder'` after the first's lock
--   releases and returns `{claimed: false}`, matching `ensureUser()`'s own
--   existing unique-violation race handling for the ordinary insert path).
-- =============================================================================

create or replace function public.claim_placeholder_user(
  p_email extensions.citext,
  p_kinde_user_id text,
  p_email_verified boolean,
  p_first_name text,
  p_last_name text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
begin
  select id, status
    into v_id, v_status
  from public.users
  where email = p_email and status = 'placeholder'
  for update;

  if v_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  update public.users
     set kinde_user_id = p_kinde_user_id,
         status = 'active',
         email_verified = p_email_verified,
         first_name = coalesce(p_first_name, first_name),
         last_name = coalesce(p_last_name, last_name)
   where id = v_id;

  return jsonb_build_object('claimed', true, 'id', v_id, 'status', 'active');
end;
$$;

comment on function public.claim_placeholder_user(
  extensions.citext, text, boolean, text, text
) is
  'Claims a status=placeholder users row (from create_manual_connection, '
  '20260926130000) on a real Kinde signup, in place — same id, status -> '
  'active. Called only by ensureUser() (2026-09-26, '
  'docs/architecture/2026-09-26-unverified-connections.md), which already '
  'holds the service role. security INVOKER, service_role only, so a '
  'mis-grant hits the absent UPDATE grant on users.status rather than '
  'bypassing it.';

revoke all on function public.claim_placeholder_user(
  extensions.citext, text, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.claim_placeholder_user(
  extensions.citext, text, boolean, text, text
) to service_role;
