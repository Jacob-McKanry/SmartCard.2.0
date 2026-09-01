-- =============================================================================
-- 20260901130000_publishing_requires_verified_host.sql
--
-- WHAT THIS CHANGES
--   Narrows the `events` INSERT policy: a client may still create an event as
--   `draft` freely, but creating one directly as `scheduled` (i.e. publishing
--   immediately, skipping the draft step) now additionally requires
--   `public.is_verified_host()`. Adds the identical check inside
--   `public.publish_event(uuid)`, so a draft cannot be published later by an
--   account that was never verified, or whose verification was revoked after
--   the draft was saved.
--
-- WHY THIS EXISTS
--   Owner request, 2026-09-01: an account that is not a verified host should
--   only be able to draft an event, or apply to become a verified host — not
--   publish one live.
--
--   THIS IS A DELIBERATE NARROWING OF Q5's RESOLVED DECISION, RECORDED AS
--   SUCH — not a silent reversal. `docs/architecture/2026-08-09-initial-
--   architecture-proposal.md` Q5 (resolved 2026-08-14): "any signed-in user
--   may create an event... no host-approval-to-become-a-host step," with the
--   reasoning that creating an event "grants the creator nothing over anybody
--   else." That reasoning is unchanged and still governs DRAFTING, which stays
--   open to every signed-in user with no gate at all. What changes is
--   narrower than it sounds: PUBLISHING is the act that makes an event
--   discoverable and answerable by strangers, and the owner's call is that
--   this one step should cost the same "convince a human once" friction §9 of
--   the CSV-import design already established for verified hosts, rather than
--   remaining unconditional. See that document's amendment (below the Q5 row)
--   for the full record.
--
-- ===========================================================================
-- WHY THIS IS TWO ENFORCEMENT POINTS, NOT ONE
-- ===========================================================================
--   Publishing happens two ways: creating an event directly as `scheduled`
--   (the INSERT policy), and calling `publish_event` on an existing draft.
--   Gating only one would leave the other as a bypass — an unverified account
--   could not create a scheduled event directly, but could still draft one
--   and immediately publish it. Both paths now check
--   `is_verified_host`, independently, from values each reads itself.
--
--   `public.is_verified_host()` is called directly in the INSERT policy — it
--   is `security definer`, self-only by construction, already granted EXECUTE
--   to `authenticated`, and exists for exactly this shape of question. No new
--   function needed. `publish_event` reads `users.is_verified_host` inline
--   instead of calling the wrapper, matching the pattern
--   `import_event_attendees`/`list_own_import_links` already use inside a
--   `security definer` body — it has unrestricted read access to `users`
--   there regardless of the client's own SELECT grant, so the extra function
--   call would add nothing.
--
-- ===========================================================================
-- WHY THIS DOES NOT NEED THE SAME `INSERT ... RETURNING` CARE AS
-- 20260901120000
-- ===========================================================================
--   That migration fixed the SELECT policy a write reads back through.
--   `is_verified_host()` reads `public.users`, a DIFFERENT table from the one
--   being written (`events`), so there is no self-reference and no risk of
--   the same "brand-new row not yet visible within this command" failure —
--   `users` already existed before this statement began.
--
-- ===========================================================================
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
-- ===========================================================================
--   Grants: nothing new. Forbids: a non-verified host can no longer INSERT an
--     event with `status = 'scheduled'` (refused by the INSERT policy's
--     `with check`, same 42501/RLS-violation shape as any other policy
--     refusal), and can no longer call `publish_event` successfully on their
--     own draft (refused with the RPC's existing generic 42501, so this
--     cannot be distinguished from "not your event" or "already published").
--     Drafting is completely unaffected — every signed-in user may still
--     create and hold a draft with no gate at all.
-- =============================================================================

drop policy "create events only as yourself" on public.events;

create policy "create events only as yourself"
on public.events for insert to authenticated
with check (
  host_user_id = (select private.current_user_id())
  and (
    status = 'draft'
    or (status = 'scheduled' and (select public.is_verified_host()))
  )
);

create or replace function public.publish_event(p_event_id uuid)
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

  -- Re-derived here rather than trusted from whatever gated the draft's
  -- creation: an account verified when the draft was saved may have been
  -- revoked since (§9.4), and an account that saved a draft before ever
  -- applying must not get to publish it just because nothing stopped the
  -- draft itself.
  if not exists (
    select 1 from public.users u
    where u.id = v_user and u.status = 'active' and u.is_verified_host
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.events
     set status = 'scheduled'
   where id = p_event_id
     and host_user_id = v_user
     and status = 'draft';

  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;

comment on function public.publish_event(uuid) is
  'Moves ONE event from draft to scheduled. Host-only, only from draft, and '
  '(20260901130000) only for a currently active verified host — refuses '
  'identically for "not your event", "no such event", "already published" and '
  '"not a verified host", so a guessed id cannot be used to probe which is '
  'true. The only writer of events.status besides soft_delete_own_account''s '
  'cancellation and the client-settable INSERT of draft|scheduled.';
