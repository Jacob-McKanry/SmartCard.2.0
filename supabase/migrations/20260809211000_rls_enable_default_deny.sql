-- =============================================================================
-- 20260809211000_rls_enable_default_deny.sql
--
-- WHAT THIS CHANGES
--   Applies the §3.1 default-deny pattern to all fifteen tables in `public`:
--       alter table ... enable row level security;
--       alter table ... force row level security;
--       revoke all on ... from anon, authenticated;
--   After this migration and before the policy migrations that follow, no
--   client role can read or write a single row of this database.
--
-- WHY EACH OF THE THREE LINES IS THERE
--   enable row level security
--     Turns policies on. Without it, policies are inert decoration and the
--     table's grants alone decide access.
--
--   force row level security
--     `enable` alone exempts the table's owner. Since our migrations, and any
--     future job that connects as `postgres`, run as the owner, that exemption
--     would mean the policies are never actually exercised by the roles most
--     likely to have a bug. Forcing it means the rules apply to everyone the
--     rules can apply to. (Roles holding the BYPASSRLS attribute — `postgres`
--     and `service_role` on this project — still bypass; that is unavoidable
--     and is precisely the privilege the server-side service layer relies on to
--     write connections, sessions and audit rows.)
--
--   revoke all ... from anon, authenticated
--     This is the line that is easy to under-read. Supabase's default
--     privileges grant ALL on every new table in `public` to both `anon` and
--     `authenticated` (verified on this project before writing this migration),
--     so without the revoke, a table whose RLS was accidentally left off is
--     wide open to unauthenticated callers. Revoking resets the table to zero
--     and forces the following migrations to state, table by table, exactly
--     which verbs each role gets.
--
-- HOW GRANTS AND POLICIES DIVIDE THE WORK — read this before adding a table
--   §3.1 shows the revoke but not the matching grant, and the two halves are
--   easy to confuse because they answer different questions:
--       GRANT  decides which *verbs* a role may attempt on a table, and
--              (with column lists) which *columns* those verbs may touch.
--       POLICY decides which *rows* an allowed verb may see or write.
--   A table with a policy but no grant is unreadable; a table with a grant but
--   no policy is readable-but-empty (RLS default-denies every row). Both halves
--   are required, and they are deliberately kept next to each other: every
--   grant in the migrations that follow sits directly beside the policy that
--   constrains it.
--
--   Column-level grants do real security work here and are not a stylistic
--   choice. RLS cannot express "you may update this row but not that column",
--   so `users.is_admin`, `cards.owner_user_id` and `connections.status`-to-
--   `active` are protected by narrowing the grant, not the policy.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: none, to anyone.
--   Forbids: everything, to `anon` and `authenticated`, on all fifteen tables.
--   `anon` is never granted anything by any migration in this set — there is no
--   such thing as an unauthenticated read in this product.
-- =============================================================================

do $$
declare
  t text;
  tables text[] := array[
    'users',
    'social_links',
    'cards',
    'events',
    'event_rsvps',
    'connection_sessions',
    'meetings',
    'meeting_locations',
    'meeting_participants',
    'connections',
    'blocks',
    'connection_attempts',
    'app_config',
    'contact_import_matches',
    'pending_connections'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;
