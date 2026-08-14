-- =============================================================================
-- 20260814060000_table_event_invites.sql
--
-- WHAT THIS CHANGES
--   Creates `public.event_invites`, the table that closes the "known limitation"
--   the Events pass recorded in §2.6: there was no way for anybody except the
--   host to see a private event, and therefore no way for a private event to
--   have guests.
--
--   Schema only. No policies and no grants are created here — those are in
--   20260814060100, kept separate for the same reason 20260814051000 and
--   20260814051100 are: the "what exists" review and the "who may touch it"
--   review should be two separate reads, and the access half of this feature is
--   the half worth reading twice.
--
-- THE GAP THIS CLOSES, PRECISELY
--   `private.can_see_event` (20260809210900) admits three kinds of viewer: the
--   event is public, the viewer is the host, or the viewer already holds an
--   `event_rsvps` row for it. For a *private* event the first branch is false by
--   definition, which leaves "host" and "already has an RSVP". And since
--   20260814051200, every RSVP write goes through `public.request_event_rsvp`,
--   which takes its caller from the JWT — so nobody can create an RSVP row on
--   somebody else's behalf, deliberately.
--
--   Those two facts together are airtight in a way that was not fully intended:
--   a private event is visible to its host and to literally nobody else, ever,
--   because the only route to visibility is a row only the viewer can create,
--   and they cannot create it without already having visibility. This table is
--   the third branch that breaks that circle.
--
-- WHY AN INVITE GRANTS VISIBILITY AND NOT AN RSVP — THE LOAD-BEARING DECISION
--   An invite row makes an event *visible* to the invitee. It does not make them
--   an attendee, does not create an `event_rsvps` row, and does not pre-answer
--   anything on their behalf. Having been invited, they still call
--   `public.request_event_rsvp` themselves, and the normal rules then apply to
--   them exactly as to anybody else (approval gate, capacity, waitlist).
--
--   The tempting shortcut — have the inviter insert a `pending` or `going` RSVP
--   for the invitee, so the existing "you have an RSVP row" branch does the work
--   and no new table is needed — is the one thing this design must not do.
--   `event_rsvps.status = 'going'` is a branch of the `users` read policy via
--   `private.shares_event_with()` (§3.4), so an RSVP row written by somebody
--   else is a profile-visibility grant written by somebody else. §2.6's Q20
--   amendment already settled this in the import case and the reasoning is
--   identical here: every row in `event_rsvps` must remain a deliberate act by
--   the person it describes. An invite is an offer; an RSVP is an answer; only
--   the invitee can give the answer.
--
-- JUDGMENT CALLS RECORDED HERE (per §3.6's convention)
--
--   `invited_by_user_id` is nullable and ON DELETE SET NULL, while
--   `invited_user_id` is NOT NULL and ON DELETE CASCADE.
--     The asymmetry is the same one `event_rsvps.decided_by` already carries
--     (20260814051000), for the same reason. An invite is a fact about the
--     person invited: if they are gone, the row describes nobody and should go
--     with them, so CASCADE. The inviter is *attribution* on that fact: if their
--     account is hard-deleted the invite still happened, and the invitee's
--     visibility of the event must not silently evaporate because a third party
--     closed their account. SET NULL keeps the grant and loses only the name.
--
--   UNIQUE (event_id, invited_user_id) — re-inviting is idempotent, not an error.
--     One invite per person per event. Two rows would mean nothing extra (the
--     visibility branch is an `exists` test) while making "who invited them"
--     ambiguous. Callers insert with `on conflict do nothing`, so tapping invite
--     twice is a no-op rather than a failure a UI has to explain — and note the
--     deliberate consequence: a second invite does NOT overwrite
--     `invited_by_user_id`, so the row keeps the person who actually opened the
--     door first rather than the most recent person to click.
--
--   `invited_user_id <> invited_by_user_id`, as a CHECK rather than only a policy.
--     Mirrors `connection_sessions_presenter_is_not_scanner` (20260809210400)
--     and exists for the same reason: the WITH CHECK in 20260814060100 already
--     forbids self-invites, but encoding it here means it holds even if a future
--     code path, a service-role script or a seeded fixture forgets. A self-invite
--     is meaningless anyway — you can already see an event you are hosting or
--     attending — so the only thing it could ever be is a mistake or an attempt
--     to manufacture a visibility row.
--     Written as `invited_by_user_id is null or ...` so that a row whose inviter
--     has since been deleted (SET NULL, above) does not violate the constraint.
--
--   No `status`, no `accepted_at`, no expiry.
--     An invite here is not a thing to accept or decline — the RSVP is where a
--     person answers, and it already has six statuses to say it with. Adding an
--     invite state machine on top would create two places that both claim to
--     record "is this person coming", which is exactly the ambiguity
--     `event_rsvps_one_per_user_per_event` exists to prevent one table down.
--     An invite is a boolean fact: it happened, or it did not.
--
--   No revoke path, and this is a scope cut rather than an oversight.
--     There is no UPDATE or DELETE grant and no such policy in 20260814060100.
--     Un-inviting was not asked for, and it is not the one-liner it looks like:
--     revoking visibility from somebody who has already RSVP'd does nothing
--     (their RSVP row keeps them visible through the older branch), so a
--     half-built revoke would silently fail exactly where a host would most
--     expect it to work. Recorded again at the policy layer where the absence is
--     visible.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- event_invites
-- ---------------------------------------------------------------------------
create table public.event_invites (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: an invite to an event that no longer exists is not a fact worth
  -- keeping. Matches `event_rsvps.event_id`.
  event_id uuid not null references public.events(id) on delete cascade,

  -- Cascade: the invite is a fact about this person. See the header.
  invited_user_id uuid not null references public.users(id) on delete cascade,

  -- SET NULL, not cascade — attribution, not subject. See the header.
  invited_by_user_id uuid references public.users(id) on delete set null,

  created_at timestamptz not null default now(),

  -- One invite per person per event; re-inviting is a no-op at the call site.
  constraint event_invites_one_per_user_per_event unique (event_id, invited_user_id),

  -- You cannot invite yourself, through any route, ever — including a
  -- service-role script that forgot to check.
  constraint event_invites_inviter_is_not_invitee
    check (invited_by_user_id is null or invited_by_user_id <> invited_user_id)
);

comment on table public.event_invites is
  'Who has been invited to see a private event. An invite grants VISIBILITY ONLY: '
  'it adds a branch to private.can_see_event() and creates no RSVP, because an '
  'RSVP written by somebody other than its subject would be a profile-visibility '
  'grant written by somebody else (private.shares_event_with, §3.4). The invitee '
  'still calls public.request_event_rsvp themselves, and the approval gate, '
  'capacity and waitlist rules then apply to them unchanged.';

comment on column public.event_invites.invited_user_id is
  'The person who may now see the event. ON DELETE CASCADE — an invite is a fact '
  'about this person and means nothing once they are gone.';

comment on column public.event_invites.invited_by_user_id is
  'Who sent the invite — the host, or an attendee holding a `going` RSVP (see '
  '20260814060100 for why only those two). Nullable and ON DELETE SET NULL, the '
  'same treatment event_rsvps.decided_by gets: if the inviter hard-deletes their '
  'account the invite still happened, and the invitee must not silently lose '
  'sight of the event because a third party closed theirs. Null therefore means '
  '"inviter gone", never "nobody invited them".';

comment on column public.event_invites.created_at is
  'When the invite was sent. Not an expiry and not compared against anything — '
  'invites do not lapse; see the migration header on why there is no state '
  'machine here.';

-- `can_see_event`'s new branch asks "does this viewer have an invite to this
-- event", which the UNIQUE constraint's index on (event_id, invited_user_id)
-- already answers. This second index serves the other direction — "what have I
-- been invited to", and the SELECT policy's invitee branch — which that index
-- cannot, since `event_id` leads it. Same reasoning as `event_rsvps_user_id_idx`.
create index event_invites_invited_user_id_idx on public.event_invites (invited_user_id);

-- §3.1's default-deny, applied exactly as 20260814051000 applied it to `cities`:
-- policies on, owner not exempt, every client-role privilege reset to zero so
-- the following migration has to state precisely what it hands back.
alter table public.event_invites enable row level security;
alter table public.event_invites force row level security;
revoke all on public.event_invites from anon, authenticated;
