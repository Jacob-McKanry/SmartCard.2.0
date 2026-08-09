-- =============================================================================
-- 20260809210500_table_meetings.sql
--
-- WHAT THIS CHANGES
--   Creates the three-table meeting model from architecture doc §2.4:
--     public.meetings              non-sensitive metadata
--     public.meeting_locations     coordinates, quarantined
--     public.meeting_participants  who was there + their per-person privacy flags
--
-- WHY THE SPLIT EXISTS (§2.4, restated because it is the reason for the shape)
--   RLS controls which *rows* are readable, not which *columns*. If latitude
--   lived on `meetings`, then any policy permissive enough to let a mutual see
--   the "A met B" feed post would also hand that mutual the coordinates, and the
--   only thing preventing a leak would be every endpoint remembering to strip
--   the field. Splitting the table means a forgotten join produces *missing*
--   location data rather than *leaked* location data. For data that says where a
--   named person physically stood at a known time, that is the only acceptable
--   failure direction.
--
-- PAIRWISE ASSUMPTION — IMPORTANT FOR ANYONE ADDING GROUP MEETINGS LATER
--   A meeting is created by exactly one verification event between exactly two
--   people: one presenter, one scanner. The location policy in §3.2 relies on
--   that — it proves the viewer is a mutual of `meeting_party(m, 1)` and
--   `meeting_party(m, 2)` and looks no further. If a future feature ever writes
--   a third participant row, that policy silently stops checking the third
--   person, and location could reach someone who is not a mutual of everyone
--   present. Introducing group meetings therefore requires revisiting §3.2, not
--   just this table.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- meetings
-- ---------------------------------------------------------------------------
create table public.meetings (
  id uuid primary key default gen_random_uuid(),

  occurred_at timestamptz not null,

  verification_method text not null
    check (verification_method in ('qr_gps', 'nfc_card')),

  -- NOT NULL and UNIQUE, both deliberately.
  --
  -- NOT NULL: "every meeting traces back to a verification session" is the
  -- structural form of the product's non-negotiable rule. A nullable column
  -- would leave room for a meeting that no verification produced. §2.5 lists
  -- `nfc_card` among `connection_sessions.method` and §2.8 describes the
  -- deferred flow hanging off "the same table QR/NFC already use", so card taps
  -- are expected to create a session row too. Flagged as a judgment call in
  -- §3.6 of the architecture doc: if the NFC redeem path is later built without
  -- creating a session, this constraint is what will catch it, and the right
  -- response is to create the session, not to drop the constraint.
  --
  -- UNIQUE: sessions are single-use (§4.2 step 6). One session producing two
  -- meetings would mean a replay succeeded. The database refuses to represent
  -- that outcome.
  verification_session_id uuid not null unique
    references public.connection_sessions(id) on delete restrict,

  event_id uuid references public.events(id) on delete set null,

  -- true = only the two participants ever see this meeting.
  is_private boolean not null default false,

  location_visibility text not null default 'participants_only'
    check (location_visibility in ('participants_only', 'mutuals')),

  created_at timestamptz not null default now()
);

comment on table public.meetings is
  'Non-sensitive metadata for one verified in-person meeting (§2.4). Coordinates '
  'deliberately live in meeting_locations, not here.';

comment on column public.meetings.is_private is
  'Meeting-level privacy flag, editable by either participant. The per-participant '
  'veto that the other party cannot override is meeting_participants.marked_private.';

comment on column public.meetings.location_visibility is
  'participants_only (default) | mutuals. Opting in to `mutuals` is necessary but '
  'not sufficient for a mutual to see coordinates — every participant must also '
  'have consented, and none may have marked the meeting private (§3.2).';

create index meetings_occurred_at_idx on public.meetings (occurred_at desc);
create index meetings_event_id_idx on public.meetings (event_id);

-- ---------------------------------------------------------------------------
-- meeting_locations
-- ---------------------------------------------------------------------------
create table public.meeting_locations (
  -- One-to-one with meetings, expressed as "the meeting id IS the primary key".
  -- Cascade because a location with no meeting is orphaned sensitive data, and
  -- orphaned sensitive data is the kind that outlives the rules that protected
  -- it.
  meeting_id uuid primary key
    references public.meetings(id) on delete cascade,

  -- NOT NULL: a location row that exists but has no coordinates conveys
  -- "we know where this happened" while being unable to say where. Absence of
  -- location is represented by the absence of the row — which is exactly the
  -- case for every `nfc_card` meeting, since card taps have no GPS gate (§4.5).
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),

  -- The reported accuracy radius of the fix. NOT NULL because the verification
  -- service cannot have accepted the connection without evaluating it against
  -- `qr_max_accuracy_m` (§4.3 check 3) — if it is missing, the row did not come
  -- from a completed verification.
  accuracy_m double precision not null check (accuracy_m >= 0),

  place_label text
);

comment on table public.meeting_locations is
  'Where a verified meeting physically happened. Every column is sensitive. '
  'SELECT is restricted by the §3.2 policy; there is deliberately no INSERT, '
  'UPDATE or DELETE policy at all — rows here are written only by the '
  'verification service, which runs with the service role (§2.4/§3.2).';

-- ---------------------------------------------------------------------------
-- meeting_participants
-- ---------------------------------------------------------------------------
create table public.meeting_participants (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,

  -- Defaults to false, per §2.4. This default is a security decision, not a
  -- style choice: sharing location with mutuals requires an affirmative act by
  -- every participant, and the §3.2 policy is written as "prove nobody
  -- objected", so a row that was never touched blocks sharing.
  location_share_consent boolean not null default false,

  -- Either participant may set this and it hides the meeting from everyone but
  -- the two of them. This is the one privacy control the other party cannot
  -- reverse.
  marked_private boolean not null default false,

  primary key (meeting_id, user_id)
);

comment on table public.meeting_participants is
  'Who was at a meeting, plus their individual privacy choices (§2.4). Consent '
  'defaults to false and is evaluated as "no participant objected" rather than '
  '"all participants agreed", so a missing or malformed row blocks sharing '
  'instead of permitting it.';

-- §2.9 lists this index: the meeting feed is driven by "meetings I was at",
-- which is a lookup on user_id.
create index meeting_participants_user_id_idx on public.meeting_participants (user_id);
