-- =============================================================================
-- 20260814051000_table_cities_and_event_capacity_columns.sql
--
-- WHAT THIS CHANGES
--   The schema half of the Events build phase (README build order item 5,
--   architecture §2.6). Three things, no policies and no grants — those are in
--   20260814051100 and 20260814051200, deliberately kept separate so the
--   "what exists" review and the "who may touch it" review are separate reads:
--
--     1. Creates `public.cities`, a curated, admin-managed reference list, and
--        seeds it with ten US metros.
--     2. Adds `city_id`, `capacity` and `requires_approval` to `public.events`.
--     3. Widens `event_rsvps.status` to six values and adds the three columns
--        that make a host decision an auditable fact rather than a silent
--        state change: `decided_by`, `decided_at`, `capacity_override`.
--
--   Both tables are empty on this project (verified: 0 rows in `events`, 0 in
--   `event_rsvps`, before writing this), which is why `city_id` can be added
--   as NOT NULL in one statement with no backfill step and no temporary
--   nullable window. If either table is ever non-empty when a change like this
--   is repeated, that is a two-phase migration, not a one-liner.
--
-- WHY CITIES ARE A TABLE AND NOT A TEXT COLUMN
--   A free-text city on `events` produces "NYC", "New York", "new york city"
--   and "Manhattan" as four different cities within a week, which makes the
--   one query browse actually needs — "what is happening near me" — unable to
--   answer correctly. Geocoding would solve that too, but it buys a vendor, a
--   key, a terms-of-service review and a failure mode (Q25 is still open on
--   exactly this for `meeting_locations.place_label`) to solve a problem the
--   pilot does not have: the pilot happens in a handful of known cities.
--
--   A curated list is also the fail-closed shape. The set of places an event
--   can claim to be in is decided by an operator in advance, so a client
--   cannot invent a location, and a typo cannot silently create an empty city
--   nobody browses.
--
-- THE SEED IS A PLACEHOLDER, NOT A PRODUCT DECISION
--   The ten metros below are a reasonable starter set chosen so the feature is
--   exercisable end to end, NOT a decision about where SmartCard operates. The
--   project owner is expected to edit this list (add, rename, deactivate) as
--   the pilot's real cities become known. Editing it is a service-role task —
--   see 20260814051100 for why clients get SELECT and nothing else.
--
-- JUDGMENT CALLS RECORDED HERE (per §3.6's convention)
--
--   `events.city_id` is ON DELETE RESTRICT.
--     A city is not personal data and deleting one must not destroy event
--     history. CASCADE would mean deactivating the wrong row in an admin tool
--     deletes every event ever held in that city, along with the RSVPs that
--     cascade from those events — a data-loss bug one click deep. SET NULL is
--     unavailable (the column is NOT NULL) and would be wrong anyway: an event
--     with no city is not a thing browse can render. RESTRICT makes the
--     database refuse the delete instead, which is why `is_active` exists.
--
--   `cities.is_active` rather than deleting a city.
--     Hiding a city from browse and destroying the history of what happened
--     there are different operations, and only the first is routine. `is_active
--     = false` removes a city from the pickers and from browse while every
--     historical event that references it stays intact and readable.
--
--   `capacity` is nullable, and NULL means unlimited.
--     A sentinel like 0 or -1 for "unlimited" would have to be remembered by
--     every caller, and forgetting it reads as "this event is full" (a real
--     event silently accepting nobody) or "capacity 0 means no limit" (a full
--     event silently accepting everyone). NULL is the value SQL already has
--     for "not applicable", and every comparison against it is false rather
--     than accidentally true. The CHECK is `capacity > 0`, not `>= 0`: an event
--     with a capacity of zero is not an event, it is a mistake, and catching it
--     at write time is cheaper than explaining an event nobody can attend.
--
--   `requires_approval` is a separate boolean from `visibility`.
--     They answer different questions — `visibility` is "who can see that this
--     event exists", `requires_approval` is "who decides whether you may come".
--     All four combinations are real: a public event with an approval gate (an
--     open call the host curates) and a private event without one (a small
--     invite-only thing where the invite *is* the approval) are both ordinary.
--     Deriving one from the other would silently take one of those away, and
--     the shape of that mistake — a host believing their public event is
--     curated when it is not — is the kind that is discovered by strangers
--     arriving. Default `false`: the state that requires no host action.
--
--   `pending` and `denied` are distinct statuses, and `denied` is distinct
--   from `not_going`.
--     "I chose not to come" and "the host decided I may not come" are
--     different facts about different people's decisions, and a requester
--     needs to be able to tell them apart. Collapsing them would also make the
--     data unable to answer "how many people did this host turn away", which
--     is exactly the number worth looking at if a pilot event goes wrong.
--
--   `capacity_override` exists so a host force-admit is discoverable.
--     A host may admit somebody past a full event's cap (see
--     20260814051200's `decide_event_rsvp`). If that were a silent write, an
--     event at 30/25 would be indistinguishable from an event whose capacity
--     was edited, and there would be no way for anyone — including the host
--     reviewing their own event later — to see that a rule was consciously
--     set aside. The narrower alternative was to forbid overrides outright;
--     that was rejected because the real-world case (someone the host actually
--     wants there, at a venue with a soft cap) is legitimate and would
--     otherwise be worked around by editing `capacity`, which loses the
--     information entirely instead of recording it.
--
--   Recurring events are NOT modelled (Q14).
--     Explicitly out of scope for this pass, resolving Q14 the way §2.6's own
--     recommendation already pointed: one `events` row per occurrence. There is
--     no `recurrence_rule`, no parent/child link and no series concept anywhere
--     below. A recurrence concept touches capacity, RSVP identity ("am I going
--     to this Tuesday or every Tuesday?") and the `shares_event_with` policy
--     branch all at once, which is a design pass of its own, not a column.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- cities
-- ---------------------------------------------------------------------------
create table public.cities (
  id uuid primary key default gen_random_uuid(),

  -- URL-safe stable identifier, e.g. 'new-york'. Exists so a browse URL can be
  -- `/events?city=new-york` rather than exposing a uuid, and so the seed below
  -- can be re-run or edited by slug without depending on generated ids.
  -- UNIQUE because two cities with the same slug would make that URL ambiguous.
  slug text not null unique,

  name text not null,

  -- Nullable on purpose. Every seeded row has one, but "state" is a US concept
  -- and this column should not have to be lied to (or filled with 'N/A') the
  -- first time a non-US city is added.
  state text,

  -- Hides a city from pickers and browse without deleting it — see the header.
  is_active boolean not null default true,

  created_at timestamptz not null default now()
);

comment on table public.cities is
  'Curated, admin-managed list of cities an event can be held in. Read-only to '
  'clients (SELECT only, see 20260814051100); edited with the service role, the '
  'same posture as app_config except that this list is readable. Deactivate via '
  'is_active rather than deleting — events reference it ON DELETE RESTRICT.';

comment on column public.cities.is_active is
  'false hides the city from browse and from event-creation pickers while leaving '
  'every historical event that references it intact. Deleting a city that has '
  'events is refused by the FK, on purpose.';

-- Browse always asks for the active list, ordered for display.
create index cities_active_name_idx on public.cities (name) where is_active;

-- The starter set. Placeholder — see the header. `on conflict do nothing` so
-- re-running this statement in a recovery scenario is not an error.
insert into public.cities (slug, name, state) values
  ('new-york',      'New York',      'NY'),
  ('san-francisco', 'San Francisco', 'CA'),
  ('los-angeles',   'Los Angeles',   'CA'),
  ('chicago',       'Chicago',       'IL'),
  ('austin',        'Austin',        'TX'),
  ('seattle',       'Seattle',       'WA'),
  ('boston',        'Boston',        'MA'),
  ('denver',        'Denver',        'CO'),
  ('atlanta',       'Atlanta',       'GA'),
  ('miami',         'Miami',         'FL')
on conflict (slug) do nothing;

-- §3.1's default-deny, applied to this table the same way 20260809211000
-- applied it to the original fifteen: policies on, owner not exempt, and every
-- client-role privilege reset to zero so the following migration has to state
-- exactly what it hands back.
alter table public.cities enable row level security;
alter table public.cities force row level security;
revoke all on public.cities from anon, authenticated;

-- ---------------------------------------------------------------------------
-- events — city, capacity, approval gate
-- ---------------------------------------------------------------------------
alter table public.events
  add column city_id uuid not null references public.cities(id) on delete restrict,
  add column capacity integer check (capacity > 0),
  add column requires_approval boolean not null default false;

comment on column public.events.city_id is
  'Which curated city this event is in. NOT NULL — browse is city-first, and an '
  'event nobody can find in a city list is an event nobody attends. ON DELETE '
  'RESTRICT: deactivate a city (cities.is_active), never delete one with history.';

comment on column public.events.capacity is
  'Maximum number of `going` RSVPs, or NULL for unlimited. Only `going` counts — '
  '`interested` is an intention and never consumes a seat. Enforced server-side '
  'by public.request_event_rsvp / public.decide_event_rsvp (20260814051200), not '
  'by a constraint: capacity is a rule about a set of rows, which a per-row CHECK '
  'cannot express.';

comment on column public.events.requires_approval is
  'Independent of `visibility`. true means a `going` request is stored as '
  '`pending` until the host decides. A public event may require approval and a '
  'private one may not — see the migration header for why neither is derived '
  'from the other.';

-- Browse's actual query: active city, upcoming first. Composite in that order
-- because `city_id` is the equality predicate and `starts_at` is the range/sort.
create index events_city_starts_at_idx on public.events (city_id, starts_at);

-- ---------------------------------------------------------------------------
-- event_rsvps — the two new outcome statuses and the decision record
-- ---------------------------------------------------------------------------
-- The status set grows from four to six. `pending` and `waitlist` and `denied`
-- are OUTCOMES computed by the server, never things a client declares about
-- itself; `going`, `interested` and `not_going` are the three a person may
-- actually express. 20260814051200 is where that distinction is enforced —
-- this constraint only decides what the column may hold, not who may put it
-- there.
alter table public.event_rsvps
  drop constraint event_rsvps_status_check;

alter table public.event_rsvps
  add constraint event_rsvps_status_check
  check (status in ('going', 'interested', 'not_going', 'waitlist', 'pending', 'denied'));

alter table public.event_rsvps
  -- Who decided. ON DELETE SET NULL rather than CASCADE: if a host account is
  -- ever hard-deleted, the decision still happened and the RSVP row it produced
  -- must not vanish with them. Matches the treatment `app_config.updated_by`
  -- already gets (§3.6).
  add column decided_by uuid references public.users(id) on delete set null,
  add column decided_at timestamptz,
  add column capacity_override boolean not null default false;

comment on column public.event_rsvps.status is
  'going | interested | not_going | waitlist | pending | denied. The first three '
  'are what a person may express about themselves; the last three are outcomes '
  'the server computes (approval gate, capacity, host decision) and a client may '
  'never assert directly. Only `going` counts as attendance for '
  'private.shares_event_with(), a branch of the users read policy — so this '
  'column has access-control consequences, not just display ones.';

comment on column public.event_rsvps.decided_by is
  'The host who approved or denied this RSVP. Read together with decided_at: '
  'both null = no host decision has ever been made; decided_at set with '
  'decided_by null = the system promoted this row off the waitlist when a seat '
  'freed (nobody decided anything, so attributing it to a person would be a lie).';

comment on column public.event_rsvps.capacity_override is
  'true when a host deliberately admitted this person past a full event''s cap. '
  'Recorded rather than silent so that an over-capacity event is explainable '
  'afterwards — by the host reviewing their own event, and by anyone looking at '
  'why the numbers do not add up.';

-- Serves three separate queries that all lead with the event: the `going` count
-- used for every capacity decision, the host's pending-approval queue, and the
-- FIFO waitlist pick (`order by responded_at` within a status).
create index event_rsvps_event_status_responded_idx
  on public.event_rsvps (event_id, status, responded_at);
