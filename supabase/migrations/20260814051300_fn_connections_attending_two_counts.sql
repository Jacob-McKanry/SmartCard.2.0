-- =============================================================================
-- 20260814051300_fn_connections_attending_two_counts.sql
--
-- WHAT THIS CHANGES
--   `private.connections_attending(event_id)` returned bare `user_id`s filtered
--   to `status = 'going'`. It now returns `(user_id, status)` rows filtered to
--   `status in ('going', 'interested')`, and gains the thin `public` wrapper
--   with an EXECUTE grant that §3.6's observation (a) has been owed since the
--   original schema migration.
--
-- WHY — Q21, AND THE DISTINCTION THAT MUST NOT BLUR
--   §2.6's 2026-08-13 amendment resolved Q21: the retention hook shows TWO
--   separately-labelled counts over the viewer's own connections — "3 going, 2
--   interested" — not one combined number, because a single "5 of your
--   connections will be there" is a promise the data does not support and gets
--   checked against reality the moment somebody walks in and counts. The
--   function as written could not produce two counts, so the display decision
--   was recorded and the implementation deferred to this build phase. This is
--   that implementation, exactly as the amendment's "Implementation
--   consequence" paragraph specifies it: one function, one graph check, the
--   caller groups the rows.
--
--   The amendment is emphatic about what this change is NOT, and it is repeated
--   here because this file is where somebody would be tempted:
--   **`private.shares_event_with()` is not touched.** That helper is a branch of
--   the `users` read policy (§3.4) and still requires `going` on BOTH sides.
--   Widening it to `interested` would mean two strangers who each tapped
--   "interested" on a public event — no attendance, no commitment, no in-person
--   contact — become mutually readable profiles, which at a large public event
--   is materially close to the global directory this product structurally
--   forbids. This function is a display answer; that one is a gate. They now
--   count different status sets on purpose, and that difference is the point.
--
-- THE TWO PRECONDITIONS THE AMENDMENT SAID TO RE-VERIFY, RE-VERIFIED
--   1. *No RLS policy references `connections_attending`.* Checked against the
--      live database immediately before writing this, not assumed from the
--      2026-08-13 note and not assumed to have survived this pass's own new
--      policies:
--
--        select p.polname, c.relname
--        from pg_policy p join pg_class c on c.oid = p.polrelid
--        where pg_get_expr(p.polqual, p.polrelid) ilike '%connections_attending%'
--           or pg_get_expr(p.polwithcheck, p.polrelid) ilike '%connections_attending%';
--        -- 0 rows
--
--      This matters because the return type changes: a policy referencing it
--      would have to be dropped and recreated, and a policy that silently
--      failed to recreate is a policy that denies everything (an outage) or,
--      worse, one whose table is left without the branch it needed.
--   2. *It derives the viewer from the JWT rather than taking a viewer
--      argument.* Preserved below, and it is the property that keeps this from
--      becoming the "who is connected to this arbitrary person" oracle §3.3
--      forbids. No signature in this file takes a viewer.
--
-- WHY A `public` WRAPPER IS NEEDED AT ALL
--   `private` is not in PostgREST's exposed-schema list and `authenticated`
--   holds no USAGE on it, so no client can call anything in `private` over
--   HTTP at any grant level (20260809211400). A `public` function is the only
--   way the apps can ask this question. The wrapper adds nothing but reach: it
--   takes the same single argument, applies no logic of its own, and the graph
--   check still happens inside the `private` function.
--
-- WHAT THIS GRANTS, EXACTLY, AND TO WHOM
--   GRANTS   EXECUTE on `public.connections_attending(uuid)` to `authenticated`.
--            What a caller can learn from it is bounded by the function body,
--            not by the grant: only people the caller is ALREADY connected to,
--            only for one event at a time, and only their RSVP status. Every
--            person in the answer is someone the caller can already see under
--            §3.4's `are_connected` branch, so it discloses nothing new about
--            anybody — it saves the caller from computing an intersection it is
--            already entitled to compute.
--   FORBIDS  Everything to `anon`. And `private.connections_attending` itself
--            stays revoked from every client role, so the wrapper remains the
--            only door.
--
-- IT MUST NEVER BE USED AS A VISIBILITY PREDICATE. It answers "who that I know
-- is going to this", for a screen. It is not, and must not become, an input to
-- any policy — §2.6's amendment states this outright and the empty result of
-- the query above is what keeps it true.
-- =============================================================================

-- A return-type change cannot be a `create or replace`, so the old function is
-- dropped explicitly. Safe precisely because of precondition 1 above: nothing
-- depends on it — no policy, no view, no other function.
drop function if exists private.connections_attending(uuid);

create or replace function private.connections_attending(p_event_id uuid)
returns table (user_id uuid, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.user_id, r.status
  from public.event_rsvps r
  where p_event_id is not null
    and r.event_id = p_event_id
    -- Both halves of the two-count hook, and nothing else. `not_going`,
    -- `waitlist`, `pending` and `denied` are deliberately absent: none of them
    -- is something a viewer's friend is doing at an event, and `pending` and
    -- `denied` in particular are facts about a host's decision that are not
    -- this function's to report.
    and r.status in ('going', 'interested')
    and private.are_connected(private.current_user_id(), r.user_id);
$$;

comment on function private.connections_attending(uuid) is
  'The caller''s own connections who are going to, or interested in, a given '
  'event, with which — the two-count retention hook (§2.6 amendment, Q21). '
  'Returns a computed answer rather than granting row access, and derives the '
  'viewer from the JWT so it cannot be asked about anyone else. Not a visibility '
  'predicate: `going`-on-both-sides remains the rule for shares_event_with().';

revoke all on function private.connections_attending(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The public wrapper
-- ---------------------------------------------------------------------------
-- `security definer` so the inner call runs with the owner's rights and does
-- not require the caller to hold USAGE on `private` — which is exactly the
-- privilege that must stay revoked, since holding it would let a client name
-- `private.are_connected` directly and turn the graph into a queryable oracle.
--
-- This does NOT change whose answer it is. `private.current_user_id()` reads
-- `auth.uid()`, which comes from the request's JWT claims and is unaffected by
-- SECURITY DEFINER — definer rights change which privileges apply, not which
-- token was presented. So the answer is still computed for the real caller, and
-- there is still no argument by which a caller could ask about somebody else.
create or replace function public.connections_attending(p_event_id uuid)
returns table (user_id uuid, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select ca.user_id, ca.status
  from private.connections_attending(p_event_id) ca;
$$;

comment on function public.connections_attending(uuid) is
  'PostgREST-callable wrapper over private.connections_attending() — the thin '
  'public entry point §3.6 observation (a) said the events phase would owe it. '
  'Adds reach, not logic.';

revoke all on function public.connections_attending(uuid) from public, anon, authenticated;
grant execute on function public.connections_attending(uuid) to authenticated;
