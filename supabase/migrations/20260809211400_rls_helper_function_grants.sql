-- =============================================================================
-- 20260809211400_rls_helper_function_grants.sql
--
-- WHAT THIS CHANGES
--   Grants EXECUTE on the seven `private` helper functions that RLS policies
--   reference directly, to the `authenticated` role. Nothing else changes: the
--   `private` schema itself stays without USAGE for client roles, and
--   private.connections_attending() stays revoked.
--
-- WHY — A CORRECTION TO THE REASONING IN 20260809210900
--   That migration revoked EXECUTE on every helper from `anon` and
--   `authenticated`, on the stated belief that RLS policy expressions are
--   evaluated with the table owner's rights and therefore do not re-check the
--   caller's EXECUTE privilege. **That belief is wrong**, and was caught by
--   exercising the policies against a simulated JWT rather than by reading the
--   catalog:
--
--       set local role authenticated;
--       set local request.jwt.claims = '{"sub":"<a real users.id>"}';
--       select count(*) from public.users;
--       -- ERROR: 42501: permission denied for function current_user_id
--
--   Postgres sets `checkAsUser` to the table owner for *relations* referenced
--   inside a policy expression, which is why a policy may read a table the
--   caller cannot. It does not extend that to *functions*: EXECUTE is still
--   checked against the calling role. With the blanket revoke in place, every
--   policy in this schema failed with a permission error for every real user —
--   a total outage rather than a leak, which is the right direction to fail in,
--   but an outage nonetheless.
--
--   Migrations are not rewritten after they are applied, so the incorrect
--   revoke stands in history and this migration supersedes it.
--
-- WHY THIS DOES NOT REOPEN THE GRAPH ORACLE §3.3 FORBIDS
--   The concern behind the original revoke was real: `private.are_connected(a, b)`
--   answers a question about two arbitrary users, and §3.3 states that no
--   function may answer "who is connected to this arbitrary person". Granting
--   EXECUTE does not make that function reachable, for two independent reasons:
--
--     1. Schema USAGE on `private` remains revoked from `anon` and
--        `authenticated` (20260809210000). A caller cannot name
--        `private.are_connected` in a query at all — name resolution fails
--        before the EXECUTE privilege is ever consulted. Policy expressions are
--        unaffected because they were resolved to specific function OIDs when
--        the policy was created, so they never perform name resolution at query
--        time. This was verified: with EXECUTE granted and USAGE still revoked,
--        the policies evaluate correctly and a direct call is refused.
--     2. PostgREST exposes only the schemas in its exposed-schema list
--        (`public`, `graphql_public`). There is no HTTP path to a function in
--        `private` regardless of any grant, so the API surface a real client
--        talks to cannot reach these at all.
--
--   The grant is therefore the minimum needed to make policies evaluable, and
--   the containment §3.3 asks for is carried by schema USAGE and PostgREST
--   configuration rather than by the EXECUTE bit.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: EXECUTE to `authenticated` on exactly the seven helpers that appear
--           inside a policy expression.
--   Forbids: still nothing to `anon` — it holds no grant anywhere in this
--           schema. `private.connections_attending()` is deliberately excluded:
--           no policy calls it, so no policy needs it, and the client-facing
--           wrapper it will eventually need belongs to the events build phase.
-- =============================================================================

grant execute on function private.current_user_id() to authenticated;
grant execute on function private.are_connected(uuid, uuid) to authenticated;
grant execute on function private.is_mutual_of_both(uuid, uuid, uuid) to authenticated;
grant execute on function private.meeting_party(uuid, integer) to authenticated;
grant execute on function private.shares_event_with(uuid, uuid) to authenticated;
grant execute on function private.can_see_meeting(uuid, uuid) to authenticated;
grant execute on function private.can_see_event(uuid, uuid) to authenticated;

-- The `updated_at` trigger function is deliberately NOT granted. Trigger
-- functions are permission-checked when the trigger is created, not when it
-- fires, so `users_set_updated_at` runs for an ordinary user update without the
-- calling role holding EXECUTE. (Verified against a simulated authenticated
-- profile update; if that ever changes, an authenticated UPDATE on `users`
-- would start failing loudly rather than silently skipping the timestamp.)
