-- =============================================================================
-- 20260814060100_rls_policies_event_invites_and_extend_can_see_event.sql
--
-- WHAT THIS CHANGES
--   Two things, and the second one is the whole feature:
--
--     1. Policies and narrow grants for `public.event_invites` (created empty
--        and locked down by 20260814060000): SELECT and INSERT to
--        `authenticated`, nothing else to anybody.
--     2. `private.can_see_event()` gains a third visibility branch — an invited
--        user may see the event they were invited to.
--
--   Item 2 is one `or exists (...)` and it is the only line in this pass that
--   changes what anybody can read. Everything else here exists to control who
--   may cause that line to become true.
--
-- WHAT THIS GRANTS, EXACTLY, AND TO WHOM
--
--   public.event_invites
--     GRANTS   SELECT, to `authenticated`, on rows where the caller is the
--              invitee, the inviter, or the host of the event the invite is for.
--              INSERT on exactly three columns (`event_id`, `invited_user_id`,
--              `invited_by_user_id`), to `authenticated`, restricted by the
--              WITH CHECK below to invites the caller is actually entitled to
--              send.
--     FORBIDS  UPDATE and DELETE, to every client role — no policy and no grant.
--              See "no revoke path" below; this is a decision, not an omission.
--              Setting `id` or `created_at` at insert time: neither is in the
--              column grant, so both take their defaults. The same reasoning
--              20260814051100 gives for `events` — a client-chosen `id` lets a
--              caller pick a key something else may already refer to, and a
--              client-chosen `created_at` lets a row lie about when it happened.
--     `anon`   gets nothing, here as everywhere.
--
--   private.can_see_event(viewer, event_id)
--     Now returns true for one additional case: an `event_invites` row exists
--     naming this viewer for this event. Unchanged for everybody else.
--
-- WHO MAY SEND AN INVITE, AND WHY THE LIST IS THIS SHORT
--   The host, or somebody currently holding a `going` RSVP on that event. That
--   is the whole list, and both halves are deliberate.
--
--   *Not just the host*, because a private event with one gatekeeper is not how
--   people actually bring a friend to a thing, and the alternative users reach
--   for — the host handing out their own credentials, or an out-of-band link —
--   is worse than the mechanism it replaces. `going` specifically, not
--   `interested`: an intention is not attendance, which is the same line
--   `private.shares_event_with()` draws and for the same reason. Somebody
--   `pending`, `waitlist`, `denied` or `not_going` cannot invite — they have not
--   been admitted (or have declined), and letting a `pending` request bring
--   guests would route straight around the host's approval gate.
--
--   Note the two properties this keeps. An inviter must satisfy the check *at
--   the moment they insert*, so a person denied or withdrawn stops being able to
--   invite immediately — there is no cached capability. And the check is on
--   `going`, which for an approval-gated event only the host can grant, so on
--   those events the host still transitively controls the entire guest list.
--
-- WHO AN INVITE MAY REACH — THE SECURITY DECISION IN THIS PASS
--   `private.are_connected(inviter, invitee)` must be true. An invite may only
--   ever reach somebody the inviter has already met through an NFC tap or a
--   GPS-verified scan.
--
--   This is the constraint worth arguing for, because an invite is not itself a
--   connection and it would be easy to conclude it therefore needs no graph
--   check. What an invite *is* is a way to put a person into an event's
--   population, and an event's population is an input to the `users` read policy
--   (§3.4) the moment two people are both `going`. Without the connection
--   requirement the chain runs: I create a private event, I invite an arbitrary
--   user id, they RSVP `going`, I RSVP `going`, and we are now mutually readable
--   profiles — with no tap, no scan, and nothing the other person had to
--   recognise as a stranger's approach. That is the shape Q20 closed for
--   imported guest lists ("importing an external guest list would mean people
--   who never made a SmartCard choice are inserted into a table that decides who
--   can read whose profile"), arriving by a different door.
--
--   With the requirement in place, every person who can be pulled into a private
--   event is somebody the puller already verifiably met in person. The invite
--   mechanism therefore rides on the connection graph rather than widening it,
--   and CLAUDE.md's non-negotiable rule — connections come only from verified
--   in-person contact — is left holding exactly as much weight as before. Note
--   what this specifically is not: it is not a way to reach a stranger, and
--   because `invited_user_id` must be an existing connection, it cannot be used
--   to probe whether an arbitrary user id exists either. A caller who is not
--   connected to the id they name gets the same refusal whether that id is real
--   or invented.
--
--   Public events carry no such restriction and need none: any signed-in user
--   can already see and join a public event with no invite at all (§2.6's
--   deliberate exception). An invite to a public event is therefore redundant
--   rather than dangerous, and the CHECK does not bother to forbid it — adding a
--   `visibility = 'private'` condition would buy no safety and would make the
--   policy read as though public invites were the risk, which they are not.
--
-- WHAT AN INVITE DOES NOT DO
--   It does not create an RSVP, and it must never be changed to. The invitee
--   still calls `public.request_event_rsvp` themselves; approval, capacity and
--   waitlist then apply to them exactly as to anybody else. The invariant being
--   protected is that every `event_rsvps` row is a deliberate act by the person
--   it describes — that invariant is what makes `shares_event_with()` safe to
--   have at all, and this pass does not spend any of it. 20260814060000's header
--   sets this out at greater length; it is repeated here because this is the
--   file somebody will read when they want to "just also create the RSVP".
--
--   It also grants nothing beyond the event. Seeing a private event does not
--   make its host's or its attendees' profiles readable, does not reveal the
--   attendee list (`event_rsvps` stays narrow), and offers no connect action.
--   The blast radius of an invite is one event row, plus its cover image via the
--   `event-covers` read policy (20260814051400), which is keyed to
--   `can_see_event` precisely so cover visibility tracks event visibility rather
--   than drifting from it.
--
-- WHY THE HOST CAN READ EVERY INVITE TO THEIR OWN EVENT
--   The SELECT policy's third branch. A host is accountable for who is in the
--   room at their own event, and an attendee-invite mechanism they cannot see
--   the results of would be one they cannot manage. This discloses only invite
--   rows — user ids and who invited whom — and no profile fields; reading a
--   `users` row still requires a graph relationship or one of §3.4's existing
--   branches. It is not a new visibility rule about people, it is the host
--   seeing their own event's guest list.
--
-- JUDGMENT CALLS RECORDED HERE (per §3.6's convention)
--
--   No UPDATE policy and no DELETE policy, on purpose — the same way
--   20260809211300 recorded "no INSERT policy and no INSERT grant, on purpose"
--   for `events` before Q5 landed.
--     Un-inviting was not asked for in this pass and is deliberately not built.
--     It is also not the small addition it appears to be, which is the better
--     reason to leave it out than "nobody asked": revoking an invite from
--     somebody who has already RSVP'd would not remove their visibility, because
--     `can_see_event`'s older "has an RSVP row" branch still holds. A DELETE
--     policy on this table alone would therefore work exactly when it does not
--     matter and silently fail when it does — a host clicking "uninvite" on
--     somebody already attending and watching nothing happen. A real revoke is a
--     decision about the RSVP too (eject, which 20260814051200 already declined
--     to build for the same reason: different consequences, different
--     notification obligations), so it belongs to a reviewed pass of its own.
--
--   Re-inviting is idempotent rather than an error.
--     Enforced by the UNIQUE constraint plus `on conflict do nothing` at the
--     call site (`inviteToEvent` in
--     `apps/web/src/server/events/events-service.ts`). Tapping invite twice is a
--     no-op, not a failure a UI has to explain. Consequence worth knowing: the
--     second insert does not overwrite `invited_by_user_id`, so the row records
--     whoever opened the door first.
--
--   The "host or `going` attendee" test is an inline `exists` against
--   `event_rsvps`, not a new `private.*` helper.
--     Every other cross-table access rule in this schema is a `security definer`
--     helper, so the departure is worth justifying. This question is asked from
--     exactly one place — this policy — and §3.6's argument for the helpers is
--     specifically that a rule applied from *more than one* table's policy must
--     not be written twice. A helper for a single call site would add an
--     indirection and a second grant to keep in step without removing any
--     duplication. The mechanics were verified rather than assumed before
--     choosing this: the referenced `event_rsvps` rows are the caller's own, and
--     an inline `exists` in this position does resolve them correctly for the
--     `going` attendee while refusing a caller with no RSVP (42501) — checked
--     against this database in a rolled-back transaction before this migration
--     was written. If a second call site ever appears, that is the moment to
--     promote it to a helper.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- event_invites — grants
-- ---------------------------------------------------------------------------
grant select on public.event_invites to authenticated;

-- `id` and `created_at` are deliberately absent; both take their defaults.
grant insert (
  event_id,
  invited_user_id,
  invited_by_user_id
) on public.event_invites to authenticated;

-- ---------------------------------------------------------------------------
-- event_invites — SELECT
-- ---------------------------------------------------------------------------
-- Three branches, narrowest first: the person invited, the person who invited
-- them, and the host of the event in question. Nobody else — an invite list is
-- not readable by other invitees, so being invited to a private event does not
-- tell you who else was.
create policy "read invites you received, sent, or host"
on public.event_invites for select to authenticated
using (
  invited_user_id = (select private.current_user_id())
  or invited_by_user_id = (select private.current_user_id())
  or (select private.is_event_host(private.current_user_id(), event_invites.event_id))
);

-- ---------------------------------------------------------------------------
-- event_invites — INSERT
-- ---------------------------------------------------------------------------
-- Four conditions, all required. In order: act as yourself; not yourself; only
-- reach an existing connection; and be entitled to invite to this event at all.
-- The header explains each at length — in particular why the connection check is
-- the security-relevant one rather than a politeness.
create policy "invite only your own connections, only to events you host or attend"
on public.event_invites for insert to authenticated
with check (
  -- Act as yourself. The same "act as yourself" pattern `events`' INSERT policy
  -- uses for `host_user_id`; it is why `invited_by_user_id` is trustworthy as
  -- attribution rather than merely being a claim.
  invited_by_user_id = (select private.current_user_id())

  -- You cannot invite yourself. Also a CHECK constraint on the table, so it
  -- holds for service-role writes too.
  and invited_user_id <> (select private.current_user_id())

  -- The invite may only reach somebody you already met in person. This is the
  -- line that keeps a private event's guest list inside the connection graph.
  and (select private.are_connected(private.current_user_id(), event_invites.invited_user_id))

  -- And you must be the host, or actually going.
  and (
    (select private.is_event_host(private.current_user_id(), event_invites.event_id))
    or exists (
      select 1
      from public.event_rsvps r
      where r.event_id = event_invites.event_id
        and r.user_id = (select private.current_user_id())
        and r.status = 'going'
    )
  )
);

-- ---------------------------------------------------------------------------
-- private.can_see_event — the one line that closes the gap
-- ---------------------------------------------------------------------------
-- Unchanged from 20260809210900 except for the final `or exists`, which adds
-- invited users. Restated in full rather than patched because a `create or
-- replace` of a security definer function is a total rewrite of that function's
-- body, and a reader comparing the two versions should be able to see the whole
-- of both.
--
-- Read this next paragraph before changing anything below it. This helper is
-- called by the `events` SELECT policy, by `public.request_event_rsvp`'s
-- visibility check (20260814051200) and by the `event-covers` Storage read
-- policy (20260814051400). A mistake here is a disclosure across all three at
-- once, not a typo. The three consequences of the new branch, each intended:
-- an invited user can see the event row, can RSVP to it (which is the point —
-- an invite they cannot answer is not an invite), and can load its cover image.
--
-- What is deliberately NOT widened: the `public` branch is untouched, the host
-- branch is untouched, the existing RSVP branch is untouched, and nothing here
-- says anything about `event_rsvps` visibility or about `users`. Being invited
-- to an event does not make anybody's profile readable — that still requires a
-- graph relationship or one of §3.4's existing branches, `shares_event_with()`
-- among them, which still needs `going` on both sides and is not touched by
-- this pass.
--
-- Still `security definer` with `set search_path = ''`, still null-safe: a null
-- viewer or a null event id makes every branch false, so an unauthenticated
-- caller fails closed exactly as before.
create or replace function private.can_see_event(viewer uuid, p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select viewer is not null
     and p_event_id is not null
     and exists (
       select 1
       from public.events e
       where e.id = p_event_id
         and (
           e.visibility = 'public'
           or e.host_user_id = viewer
           or exists (
             select 1
             from public.event_rsvps r
             where r.event_id = e.id
               and r.user_id = viewer
           )
           -- Added 20260814060100. A private event is otherwise visible to its
           -- host and nobody else, because the only other branch needs an RSVP
           -- row that only its own subject can create.
           or exists (
             select 1
             from public.event_invites i
             where i.event_id = e.id
               and i.invited_user_id = viewer
           )
         )
     );
$$;

comment on function private.can_see_event(uuid, uuid) is
  'Whether a viewer may see an event: public events to any authenticated user '
  '(deliberate exception, §2.6), private events to the host, to anyone who already '
  'has an RSVP row for it, and — since 20260814060100 — to anyone holding an '
  'event_invites row for it. An invite grants visibility only: it lets the invitee '
  'see the event and call request_event_rsvp for themselves, and creates no RSVP '
  'and no profile visibility on its own.';
