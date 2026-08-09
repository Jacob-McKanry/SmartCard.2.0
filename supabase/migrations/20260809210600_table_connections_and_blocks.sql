-- =============================================================================
-- 20260809210600_table_connections_and_blocks.sql
--
-- WHAT THIS CHANGES
--   Creates `public.connections` (architecture doc §2.3) and `public.blocks`
--   (§2.3, the recommended addition tracked as Q4).
--
-- WHY THE ORDERED-PAIR CONSTRAINT IS THE WHOLE POINT
--   `connections` stores one row per relationship with the smaller UUID in
--   `user_a_id`, enforced by CHECK (user_a_id < user_b_id) and UNIQUE
--   (user_a_id, user_b_id). Together those two constraints make it *impossible
--   to represent* a one-directional relationship or a duplicate one. That is
--   deliberate and must not be "simplified" into an application-level check:
--   an application check can be forgotten by one new code path, whereas this
--   cannot be bypassed by any code path at all, including a direct psql session
--   or a service-role script.
--
--   Concretely: follow/following cannot be reintroduced by accident, because
--   there is no row shape that expresses "A follows B but B does not follow A".
--   Reintroducing it would take a reviewed migration that visibly drops a
--   constraint — which is exactly the kind of change this project wants to be
--   loud.
--
-- WHY origin_meeting_id IS NOT NULL
--   The product rule is that a connection can only come from verified in-person
--   contact. `origin_meeting_id` is that rule written into the schema: every
--   edge names the meeting that created it, that meeting names the verification
--   session that produced it, and that session names the method. An edge with a
--   null origin would be an edge nobody can account for.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- connections
-- ---------------------------------------------------------------------------
create table public.connections (
  id uuid primary key default gen_random_uuid(),

  -- Cascade on both sides: an edge is meaningless once either endpoint is gone,
  -- and leaving a dangling half-edge would break every graph helper that
  -- assumes both users exist.
  user_a_id uuid not null references public.users(id) on delete cascade,
  user_b_id uuid not null references public.users(id) on delete cascade,

  -- RESTRICT: the meeting is the evidence for this edge. Deleting the evidence
  -- while the edge survives would leave a connection that cannot be justified.
  origin_meeting_id uuid not null
    references public.meetings(id) on delete restrict,

  status text not null default 'active'
    check (status in ('active', 'removed')),

  created_at timestamptz not null default now(),

  -- See the header. These two lines are the mutuality guarantee.
  constraint connections_ordered_pair check (user_a_id < user_b_id),
  constraint connections_unique_pair unique (user_a_id, user_b_id)
);

comment on table public.connections is
  'The social graph. Mutual by construction (§2.3): the ordered-pair CHECK plus '
  'the UNIQUE constraint make a one-directional or duplicate edge structurally '
  'impossible. There is deliberately no INSERT policy — createVerifiedConnection(), '
  'running with the service role, is the only writer (§4.7 threat 4).';

comment on column public.connections.status is
  'active | removed. The removal transition is one-way through RLS: a removed '
  'connection cannot be set back to active by a client, because re-establishing it '
  'must go through a fresh verified meeting like any other connection.';

-- §2.9 asks for indexes on both endpoint columns. `user_a_id` is already served
-- by the leading column of the connections_unique_pair index, so only the
-- second one needs creating — an extra index on user_a_id would be a pure
-- duplicate that costs write throughput and buys nothing.
create index connections_user_b_id_idx on public.connections (user_b_id);
create index connections_origin_meeting_id_idx on public.connections (origin_meeting_id);

-- ---------------------------------------------------------------------------
-- blocks
-- ---------------------------------------------------------------------------
create table public.blocks (
  blocker_user_id uuid not null references public.users(id) on delete cascade,
  blocked_user_id uuid not null references public.users(id) on delete cascade,

  created_at timestamptz not null default now(),
  reason text,

  primary key (blocker_user_id, blocked_user_id),

  constraint blocks_no_self_block check (blocker_user_id <> blocked_user_id)
);

comment on table public.blocks is
  'Who has blocked whom (§2.3, Q4 still open on pilot scope). Readable only by the '
  'blocker: a policy branch on blocked_user_id would tell someone they had been '
  'blocked, which is both a safety problem and an invitation to work around it. '
  'Blocks are consulted at connection time by the verification service (§4.2 step '
  '5.7 / §4.5 step 4); they are deliberately not part of the users read policy — '
  'see the note in 20260809211100.';

create index blocks_blocked_user_id_idx on public.blocks (blocked_user_id);
