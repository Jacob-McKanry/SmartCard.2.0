-- =============================================================================
-- 20260830140000_fn_is_admin_reader.sql
--
-- WHAT THIS CHANGES
--   Adds `public.is_admin()`. No table changes, no existing function or grant
--   altered — `private.is_admin()` (20260827120000) is untouched and remains
--   the function every policy and RPC actually gates on.
--
-- WHY THIS EXISTS
--   The admin review queue page (`/admin/host-applications`) needs to decide,
--   for ROUTING, whether to show the queue or a 404 — the same shape
--   `/events/[eventId]/import/page.tsx` already uses `isVerifiedHost` for.
--   `private.is_admin()` cannot serve that: it lives in the `private` schema,
--   which is not part of PostgREST's exposed API, so `supabase.rpc(...)` from
--   the app cannot reach it at all. `public.is_verified_host()`
--   (20260827120000) already establishes the exact pattern this needs — a
--   thin, self-only, `security definer` public wrapper around a private
--   helper — for the identical reason: `is_admin` is deliberately excluded
--   from `users`' SELECT grant (20260814230000), so there is no other way for
--   a screen to ask "am I one?".
--
-- WHY THIS IS SAFE TO ADD, STATED EXPLICITLY BECAUSE IT SOUNDS LIKE IT MIGHT
-- NOT BE
--
--   This does not create a way to become an admin, or to learn whether
--   SOMEBODY ELSE is one. It takes no argument and reads
--   `private.current_user_id()` only, exactly like `is_verified_host()` — so
--   the one new fact any caller can learn is "am I currently an admin", which
--   an actual admin already knows and a non-admin gains nothing by hearing
--   confirmed. It is FOR DRAWING A SCREEN, NEVER FOR DECIDING ONE — the same
--   warning `is_verified_host()`'s TypeScript wrapper carries: every RPC an
--   admin screen calls (`admin_list_host_applications`, `decide_host_application`)
--   re-derives admin status from `private.is_admin()` itself and refuses
--   without it, so a `true` from this function buys a caller nothing beyond a
--   friendlier page.
--
-- ===========================================================================
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
-- ===========================================================================
--   Grants: EXECUTE on `public.is_admin()` to `authenticated`. Self-only by
--     construction — there is no argument, so there is no version of this
--     that answers about somebody else.
--   Forbids: everything else, unchanged. `users.is_admin` remains outside both
--     the SELECT and UPDATE grants on that table.
-- =============================================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin();
$$;

comment on function public.is_admin() is
  'Whether the CALLER is currently an active admin. Self-only by construction '
  '— takes no argument, so it cannot answer about anybody else. FOR DRAWING A '
  'SCREEN, NEVER FOR DECIDING ONE: every admin-only RPC re-derives this from '
  'private.is_admin() itself and refuses without it, so a true from here buys '
  'a caller nothing beyond routing to the right page. Exists because '
  'private.is_admin() lives outside PostgREST''s exposed schema and '
  'users.is_admin is deliberately outside the SELECT grant (20260814230000).';

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
