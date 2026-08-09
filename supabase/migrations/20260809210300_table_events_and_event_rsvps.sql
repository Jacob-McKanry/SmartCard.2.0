-- =============================================================================
-- 20260809210300_table_events_and_event_rsvps.sql
--
-- WHAT THIS CHANGES
--   Creates `public.events` and `public.event_rsvps` per architecture doc §2.6.
--   Created before `meetings` because `meetings.event_id` references it.
--
-- WHY EVENT LOCATION IS TREATED DIFFERENTLY FROM MEETING LOCATION
--   §2.6 draws the line explicitly and it is worth restating where the columns
--   live: a public event at a public venue is *meant* to be found, and its
--   coordinates describe a building. A meeting location describes where a
--   specific identified person physically was at a specific time. Same data
--   type, completely different disclosure risk — which is why event coordinates
--   sit on the main row while meeting coordinates are quarantined in their own
--   table behind their own policy (§2.4).
--
-- JUDGMENT CALLS RECORDED HERE
--   - `visibility` values are not enumerated in §2.6. Implemented as
--     `public | private`, which is the smallest set that supports the §2.6
--     reasoning ("a public event ... is meant to be found") without inventing
--     product behaviour. Default is `private`: fail closed, so an event becomes
--     broadly visible only because someone chose that.
--   - Q5 (who may create events — anyone, or hosts only?) is open. This
--     migration therefore creates no INSERT path for clients; see
--     20260809211300 for the resulting policy set and how to open it up once Q5
--     lands.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),

  -- RESTRICT: an event is shared history that other people RSVP'd to and met
  -- at. Deleting the host should not delete the record of the event out from
  -- under everyone else without a deliberate decision.
  host_user_id uuid not null references public.users(id) on delete restrict,

  title text not null,
  description text,

  starts_at timestamptz not null,
  ends_at timestamptz,

  -- IANA zone name for the venue. `starts_at` already pins the instant; this is
  -- what lets both apps render "7:00 PM" in the venue's local time rather than
  -- the viewer's. Nullable because an event can be created before the venue is
  -- confirmed.
  timezone text,

  venue_name text,
  venue_address text,

  -- Venue coordinates. Not sensitive in the way `meeting_locations` is — see
  -- the header. Range-checked so an obviously wrong value (a swapped lat/long
  -- pair, a parse failure writing 0/0-adjacent garbage) fails at write time
  -- instead of quietly placing an event in the Gulf of Guinea.
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),

  visibility text not null default 'private'
    check (visibility in ('public', 'private')),

  cover_image_path text,

  created_at timestamptz not null default now(),

  -- An event that ends before it starts is a data-entry bug; catching it here
  -- keeps every "is this event over?" query downstream honest.
  constraint events_ends_after_starts
    check (ends_at is null or ends_at >= starts_at)
);

comment on table public.events is
  'Pilot events. A `public` event row is readable by any authenticated user — a '
  'deliberate, narrow exception to the graph-gating rule (§2.6), justified in the '
  'select policy in 20260809211300. Note that reading an event never reveals who '
  'is attending: `event_rsvps` has its own, much narrower policy.';

comment on column public.events.visibility is
  'public | private. Defaults to private (fail closed). `public` is what makes the '
  'row readable by any authenticated user; `private` restricts it to the host and '
  'people who already have an RSVP row.';

create index events_host_user_id_idx on public.events (host_user_id);
create index events_starts_at_idx on public.events (starts_at desc);

-- ---------------------------------------------------------------------------
-- event_rsvps
-- ---------------------------------------------------------------------------
create table public.event_rsvps (
  id uuid primary key default gen_random_uuid(),

  event_id uuid not null references public.events(id) on delete cascade,

  -- Cascade: an RSVP is purely the responder's own row and means nothing once
  -- the person is gone.
  user_id uuid not null references public.users(id) on delete cascade,

  status text not null
    check (status in ('going', 'interested', 'not_going', 'waitlist')),

  responded_at timestamptz not null default now(),

  -- §2.6. One answer per person per event: without this, "how many are going"
  -- and "do we share an event" both become ambiguous, and the second of those
  -- feeds the `users` read policy (§3.4) — so an ambiguous answer there would be
  -- an access-control bug, not a display bug.
  constraint event_rsvps_one_per_user_per_event unique (event_id, user_id)
);

comment on table public.event_rsvps is
  'Who answered what for an event. Row access is narrow (self + your connections, '
  'see 20260809211300): the full attendee list is deliberately not readable. '
  'Aggregates such as "you know 4 people going" are computed by '
  'private.connections_attending() and returned as an answer, never as rows (§3.3).';

comment on column public.event_rsvps.status is
  'going | interested | not_going | waitlist. Only `going` counts as attendance for '
  'private.shares_event_with(), which is a branch of the users read policy — being '
  '"interested" in the same event must not make two strangers visible to each other.';

create index event_rsvps_user_id_idx on public.event_rsvps (user_id);
