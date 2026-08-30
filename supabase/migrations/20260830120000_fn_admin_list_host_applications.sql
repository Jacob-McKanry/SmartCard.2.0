-- =============================================================================
-- 20260830120000_fn_admin_list_host_applications.sql
--
-- WHAT THIS CHANGES
--   Adds `public.admin_list_host_applications(text)`. No table is created or
--   altered, and no existing grant or policy changes.
--
-- WHY THIS EXISTS
--   §9.3 of `docs/architecture/2026-08-27-event-attendee-import.md` specifies
--   the admin review queue: "pending applications, oldest first, showing the
--   four fields plus the applicant's existing profile (name, photo) — an admin
--   reviewing this is not a stranger to the applicant's other data." That last
--   clause is doing real work: 20260827120000 already lets an active admin
--   `SELECT` every row of `host_applications` (the policy on that table checks
--   `private.is_admin()`), but `public.users`' own SELECT grant
--   (20260814230000) is filtered by "self, connections, and co-attendees" —
--   admin is not one of those branches. So an admin could already read every
--   application and would see a blank name and no photo for anybody they had
--   not personally met, which is not a queue an admin can actually work from.
--
--   This is the narrow fix: one `security definer` function that joins the two
--   for an admin, rather than widening `users`' SELECT grant or policy to admit
--   "is an admin" as a branch. Widening the grant would let an admin read
--   phone numbers and bios for every user in the product from the client side
--   of any future direct-PostgREST path; this function returns only the two
--   fields the design doc names (name, photo) and only for people who have
--   actually submitted an application — nobody else's profile is reachable
--   through it.
--
-- ===========================================================================
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
-- ===========================================================================
--   Grants: EXECUTE on `public.admin_list_host_applications` to `authenticated`,
--     which returns rows only to an ACTIVE admin — everyone else gets an empty
--     array, matching `private.is_admin()`'s own fail-closed shape rather than
--     an exception, because "you are not an admin" is not a refusal this queue
--     needs to explain (there is no not-admin-facing screen that calls it).
--   Forbids: everything else. `users`' SELECT grant and policy are unchanged —
--     an admin still cannot read `phone_number`, `bio`, `email`, or any other
--     column of a stranger's profile through the ordinary grant. This function
--     returns exactly `first_name`, `last_name`, `photo_path`, and only for
--     applicants.
-- =============================================================================

create or replace function public.admin_list_host_applications(
  p_status text default 'pending'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  -- Fail closed to nothing, not an exception. There is no screen that shows
  -- this refusal to a non-admin — the review page 404s before ever calling it
  -- (same shape as `import/page.tsx`'s host gate) — so an empty array here is
  -- defence in depth for a Server Action reachable without loading that page,
  -- not a message anybody is meant to read.
  if not private.is_admin() then
    return '[]'::jsonb;
  end if;

  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'unknown status filter' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(t.row_data order by t.sort_key), '[]'::jsonb) into v_rows
  from (
    select
      jsonb_build_object(
        'id', ha.id,
        'user_id', ha.user_id,
        'first_name', u.first_name,
        'last_name', u.last_name,
        'photo_path', u.photo_path,
        'organization_name', ha.organization_name,
        'applicant_role', ha.applicant_role,
        'past_event_link', ha.past_event_link,
        'expected_event_size', ha.expected_event_size,
        'hosting_frequency', ha.hosting_frequency,
        'status', ha.status,
        'submitted_at', ha.submitted_at,
        'decided_at', ha.decided_at,
        'rejection_note', ha.rejection_note
      ) as row_data,
      -- One numeric key, ascending, that reads correctly for both cases.
      -- Pending queues oldest-first (§9.3: fairness — whoever has waited
      -- longest is reviewed first), so it sorts on the epoch directly.
      -- Decided applications read most-recent-first — "what did I just do"
      -- is the useful order for a history view — so the epoch is negated,
      -- which turns an ascending sort into a descending one without a second
      -- static ORDER BY clause the status argument can't select between.
      case
        when p_status = 'pending' then extract(epoch from ha.submitted_at)
        else -extract(epoch from ha.decided_at)
      end as sort_key
    from public.host_applications ha
    join public.users u on u.id = ha.user_id
    where ha.status = p_status
  ) as t;

  return v_rows;
end;
$$;

comment on function public.admin_list_host_applications(text) is
  'Host applications joined with the applicant''s name and photo, for the '
  'admin review queue (§9.3). Active admins only — fails closed to an empty '
  'array rather than an exception, since no screen surfaces this refusal to a '
  'non-admin. The join is the entire reason this exists: users'' own SELECT '
  'grant has no admin branch, by design, so this is the one narrow place an '
  'admin may read an applicant''s name and photo — nothing else about them.';

revoke all on function public.admin_list_host_applications(text) from public, anon;
grant execute on function public.admin_list_host_applications(text) to authenticated;
