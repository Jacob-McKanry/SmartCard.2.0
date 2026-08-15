import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  eventInsertSchema,
  eventUpdateSchema,
  type CityRow,
  type EventInsert,
  type EventInviteRow,
  type EventRow,
  type EventRsvpRow,
  type EventUpdate,
  type RsvpDecision,
  type RsvpIntent,
  type RsvpStatus,
  type UserRow,
} from "@smartcard/types";
import { summarizeConnectionsAttending, type ConnectionsAttendingSummary } from "@smartcard/core";

/**
 * The service layer (§1.7) for Events — RSVP + "who's going" (README build
 * order item 5, architecture §2.6).
 *
 * Every function takes the caller's own RLS-bound `SupabaseClient` — never the
 * service role — for the same reason `connections-service.ts` and
 * `profile-service.ts` do: nothing in this feature needs to bypass RLS, and the
 * database policies stay the real backstop regardless of what this file gets
 * right or wrong.
 *
 * WHERE THE SECURITY BOUNDARY IS, FEATURE BY FEATURE
 *
 * *Reads* are ordinary RLS-filtered selects. `private.can_see_event()` decides
 * which `events` rows come back (public events to anybody signed in — the one
 * deliberate exception in this schema, §2.6 — plus your own and any you hold an
 * RSVP for), and the narrow `event_rsvps` select policy decides which RSVP rows
 * do (your own, and your connections'). Neither rule is re-implemented here.
 *
 * *Writes to `event_rsvps` are not possible from this file at all.* Since
 * `20260814051200_fn_event_rsvp_write_path.sql`, `authenticated` holds no
 * INSERT, UPDATE or DELETE grant on that table, and every status transition
 * goes through one of three `security definer` RPCs. That is deliberate and is
 * the same structure the graph tables use: `going` means different real things
 * depending on the event's capacity and approval settings, and it is an input
 * to the `users` read policy via `private.shares_event_with()`, so a
 * client-asserted `going` would be a client-asserted profile-visibility grant.
 * You will not find a `.from("event_rsvps").insert(...)` anywhere below, and
 * adding one would not work.
 *
 * *Aggregates are answers, not rows.* "18 going, 3 waiting" and "4 of your
 * connections are going" come from `event_attendance_counts` and
 * `connections_attending`, because §3.3's rule is that the database hands back
 * a computed answer rather than the attendee list. Relaxing the `event_rsvps`
 * policy to compute these client-side would turn every public event into a way
 * to enumerate the people at it.
 *
 * *Invites to private events are an ordinary insert, and that is not an
 * inconsistency.* `inviteToEvent` writes `event_invites` directly rather than
 * going through an RPC, because unlike an RSVP an invite has no computed
 * component — there is no capacity to weigh, no approval gate to consult and no
 * lock to hold, so the INSERT policy can decide the whole question by itself
 * (20260814060100). What that policy enforces is worth knowing without reading
 * it: only the host or somebody holding a `going` RSVP may invite, and an invite
 * may only reach an existing *connection* of the inviter. An invite grants
 * visibility of the event and nothing else — the invitee still calls
 * `request_event_rsvp` themselves, so the rule that every `event_rsvps` row is a
 * deliberate act by its own subject survives this feature intact.
 */

// ---------------------------------------------------------------------------
// Cities
// ---------------------------------------------------------------------------

/**
 * The curated city list for pickers and browse.
 *
 * Filtered to `is_active` here rather than by the RLS policy, which is
 * `using (true)`. The two are doing different jobs: a deactivated city is not
 * *secret*, it is just retired, and an event held in one still has to render
 * its city's name. Hiding inactive rows at the policy layer would produce
 * historical events whose city renders blank.
 */
export async function listActiveCities(supabase: SupabaseClient): Promise<CityRow[]> {
  const { data, error } = await supabase
    .from("cities")
    .select("id, slug, name, state, is_active, created_at")
    .eq("is_active", true)
    .order("name");

  if (error) {
    throw new Error(`Failed to load cities: ${error.message}`, { cause: error });
  }
  return data as CityRow[];
}

// ---------------------------------------------------------------------------
// Browse and detail
// ---------------------------------------------------------------------------

export interface BrowseEventsOptions {
  /** Restrict to one city. Omit for every city. */
  cityId?: string;
  /** `upcoming` (default) or `past`, decided by `starts_at` against now. */
  when?: "upcoming" | "past";
}

/**
 * A browse row: the event plus the city it is in, which every list view needs
 * and which would otherwise be one lookup per row.
 */
export interface BrowseEventItem {
  event: EventRow;
  city: Pick<CityRow, "id" | "slug" | "name" | "state">;
}

/**
 * A cap, not pagination — the same call `feed-service.ts` documents and for the
 * same reason. The pilot is a handful of cities with a handful of events each;
 * cursor pagination is machinery aimed at a scale this product does not have
 * yet. Revisit with real pagination, not a bigger number, if a city's event
 * count starts approaching this.
 */
const BROWSE_LIMIT = 50;

/**
 * Public events, newest-first for the past and soonest-first for what is
 * coming up.
 *
 * `.eq("visibility", "public")` is a *product* filter, not a security one — RLS
 * would already withhold any private event the caller cannot see. It is here
 * because browse is the public directory of events: a host's own private events
 * turning up in a city browse alongside public ones would be a confusing list,
 * and they have their own view (`listHostedEvents`). Removing this line would
 * not leak anything; it would just make browse mean something else.
 */
export async function browseEvents(
  supabase: SupabaseClient,
  options: BrowseEventsOptions = {},
): Promise<BrowseEventItem[]> {
  const when = options.when ?? "upcoming";
  const nowIso = new Date().toISOString();

  let query = supabase
    .from("events")
    .select(
      "id, host_user_id, city_id, title, description, starts_at, ends_at, timezone, venue_name, venue_address, latitude, longitude, visibility, capacity, requires_approval, cover_image_path, created_at, cities!inner(id, slug, name, state)",
    )
    .eq("visibility", "public")
    .limit(BROWSE_LIMIT);

  if (options.cityId) {
    query = query.eq("city_id", options.cityId);
  }

  query =
    when === "upcoming"
      ? query.gte("starts_at", nowIso).order("starts_at", { ascending: true })
      : query.lt("starts_at", nowIso).order("starts_at", { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load events: ${error.message}`, { cause: error });
  }

  return (data ?? []).map(splitEmbeddedCity);
}

/**
 * One event by id, or `null` if it does not exist *or* the caller may not see
 * it.
 *
 * Those two cases are indistinguishable on purpose, the same posture
 * `getConnectionForViewer` takes: `private.can_see_event()` already makes "not
 * visible to you" and "no such event" produce the same empty result, and
 * telling them apart here — with the service role, say, for a nicer error —
 * would turn this function into a probe for whether a given private event
 * exists.
 */
export async function getEventForViewer(
  supabase: SupabaseClient,
  eventId: string,
): Promise<BrowseEventItem | null> {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, host_user_id, city_id, title, description, starts_at, ends_at, timezone, venue_name, venue_address, latitude, longitude, visibility, capacity, requires_approval, cover_image_path, created_at, cities!inner(id, slug, name, state)",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load event: ${error.message}`, { cause: error });
  }
  return data === null ? null : splitEmbeddedCity(data);
}

/** The caller's own answer for one event, or `null` if they have not answered. */
export async function getOwnRsvp(
  supabase: SupabaseClient,
  eventId: string,
  userId: string,
): Promise<EventRsvpRow | null> {
  const { data, error } = await supabase
    .from("event_rsvps")
    .select("id, event_id, user_id, status, responded_at, decided_by, decided_at, capacity_override")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle<EventRsvpRow>();

  if (error) {
    throw new Error(`Failed to load your RSVP: ${error.message}`, { cause: error });
  }
  return data;
}

// ---------------------------------------------------------------------------
// A person's own events
// ---------------------------------------------------------------------------

/** Events the caller hosts, soonest first — including private ones. */
export async function listHostedEvents(
  supabase: SupabaseClient,
  userId: string,
): Promise<BrowseEventItem[]> {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, host_user_id, city_id, title, description, starts_at, ends_at, timezone, venue_name, venue_address, latitude, longitude, visibility, capacity, requires_approval, cover_image_path, created_at, cities!inner(id, slug, name, state)",
    )
    .eq("host_user_id", userId)
    .order("starts_at", { ascending: false })
    .limit(BROWSE_LIMIT);

  if (error) {
    throw new Error(`Failed to load your events: ${error.message}`, { cause: error });
  }
  return (data ?? []).map(splitEmbeddedCity);
}

/**
 * The events the caller has been invited to see — and nothing else about
 * invites.
 *
 * WHY THIS FUNCTION HAD TO EXIST BEFORE THE SCREENS COULD SHIP
 *
 * An invite to a *private* event is the only thing that makes that event
 * visible to the invitee (`private.can_see_event`'s third branch,
 * 20260814060100). But until this function, nothing could list them: it is not
 * public, so `browseEvents` excludes it; the invitee does not host it, so
 * `listHostedEvents` excludes it; and an invite creates no RSVP row — that is
 * the invariant that keeps `shares_event_with()` safe — so `listAttendingEvents`
 * excludes it too. The event was reachable only by somebody typing its id into
 * the URL bar, which made the whole invite mechanism inert.
 *
 * WHY IT NEEDS NO NEW GRANT, POLICY OR RPC
 *
 * Both halves are rows the caller may already read. The `event_invites` SELECT
 * policy's first branch is `invited_user_id = current_user_id()`, so the first
 * query returns exactly the caller's own invites and nobody else's — it cannot
 * be used to see who *else* was invited to the same event. The second query is
 * an ordinary `events` select, so `can_see_event` decides it independently,
 * which is why this is two plain queries rather than an embed: if an invite were
 * somehow readable for an event that is not, the event simply does not come
 * back and the row is dropped.
 *
 * `userId` is not what scopes the result — RLS has already done that — and is
 * used only to re-check each returned row really is the caller's, the same
 * belt-and-braces posture the rest of this file takes.
 *
 * Deliberately returns the *events*, not the invite rows. Handing back
 * `invited_by_user_id` by default would put an identity in the result of a
 * function whose job is a list of events, and no screen needs it.
 */
export async function listInvitedEvents(
  supabase: SupabaseClient,
  userId: string,
): Promise<BrowseEventItem[]> {
  const { data: invites, error: invitesError } = await supabase
    .from("event_invites")
    .select("event_id, invited_user_id")
    .eq("invited_user_id", userId)
    .limit(BROWSE_LIMIT);

  if (invitesError) {
    throw new Error(`Failed to load your invites: ${invitesError.message}`, { cause: invitesError });
  }

  const eventIds = (invites ?? [])
    .filter((row) => row.invited_user_id === userId)
    .map((row) => row.event_id as string);

  if (eventIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("events")
    .select(
      "id, host_user_id, city_id, title, description, starts_at, ends_at, timezone, venue_name, venue_address, latitude, longitude, visibility, capacity, requires_approval, cover_image_path, created_at, cities!inner(id, slug, name, state)",
    )
    .in("id", eventIds)
    .order("starts_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load the events you were invited to: ${error.message}`, {
      cause: error,
    });
  }
  return (data ?? []).map(splitEmbeddedCity);
}

/**
 * The host's name and photo for one event, or `null` when the caller may not
 * read them.
 *
 * `null` IS THE COMMON CASE AND IS NOT AN ERROR. `public.users`'s read policy
 * (§3.4) lets you read somebody only if they are you, a connection of yours, or
 * somebody you are both `going` to an event with. Hosting an event creates no
 * RSVP row, so for most viewers of most public events the host's name is simply
 * not readable and this returns `null`. The screen then names no host rather
 * than inventing one — the same "degrades to absent, never to empty or to
 * invented" shape the card-preview screens use for a missing block.
 *
 * Note what this deliberately is *not*: a lookup of an arbitrary user id. Its
 * only caller passes an `events.host_user_id` it read through the same
 * RLS-bound client, so it cannot be pointed at a person of the caller's
 * choosing. A general `getUserById` in this codebase would be the first half of
 * the directory CLAUDE.md forbids.
 */
export async function getEventHostProfile(
  supabase: SupabaseClient,
  hostUserId: string,
): Promise<Pick<UserRow, "id" | "first_name" | "last_name" | "photo_path"> | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id, first_name, last_name, photo_path")
    .eq("id", hostUserId)
    .maybeSingle();

  // A refusal here means "you may not read this person", which is an answer
  // rather than a failure — the same posture `getEventForViewer` takes for an
  // event the caller cannot see. It must not take an event page down.
  if (error) {
    return null;
  }
  return (data as Pick<UserRow, "id" | "first_name" | "last_name" | "photo_path"> | null) ?? null;
}

export interface AttendingEventItem extends BrowseEventItem {
  /** The caller's own RSVP for this event — always their own row, never anyone else's. */
  rsvp: EventRsvpRow;
}

/**
 * Every event the caller has answered for, with their answer — their attending
 * history, including `pending`, `waitlist` and `denied`, because a person is
 * entitled to see the state of their own requests.
 *
 * Two queries rather than an embed: the `event_rsvps` select policy and the
 * `events` select policy are evaluated independently, and reading the RSVPs
 * first then fetching exactly those events keeps it obvious which policy is
 * responsible for which half. A missing event for one of the caller's own RSVP
 * rows would mean the event became invisible to them (they withdrew from a
 * private event in another tab, say) — the row is skipped rather than rendered
 * half-populated, the same fail-closed shape `listOwnConnections` uses.
 */
export async function listAttendingEvents(
  supabase: SupabaseClient,
  userId: string,
): Promise<AttendingEventItem[]> {
  const { data: rsvps, error: rsvpsError } = await supabase
    .from("event_rsvps")
    .select("id, event_id, user_id, status, responded_at, decided_by, decided_at, capacity_override")
    .eq("user_id", userId)
    .order("responded_at", { ascending: false })
    .limit(BROWSE_LIMIT);

  if (rsvpsError) {
    throw new Error(`Failed to load your RSVPs: ${rsvpsError.message}`, { cause: rsvpsError });
  }
  if (!rsvps || rsvps.length === 0) {
    return [];
  }

  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select(
      "id, host_user_id, city_id, title, description, starts_at, ends_at, timezone, venue_name, venue_address, latitude, longitude, visibility, capacity, requires_approval, cover_image_path, created_at, cities!inner(id, slug, name, state)",
    )
    .in(
      "id",
      rsvps.map((r) => r.event_id),
    );

  if (eventsError) {
    throw new Error(`Failed to load the events you answered: ${eventsError.message}`, {
      cause: eventsError,
    });
  }

  const byId = new Map((events ?? []).map((row) => [row.id as string, splitEmbeddedCity(row)]));

  return (rsvps as EventRsvpRow[]).flatMap((rsvp): AttendingEventItem[] => {
    const item = byId.get(rsvp.event_id);
    return item ? [{ ...item, rsvp }] : [];
  });
}

// ---------------------------------------------------------------------------
// Aggregates — computed answers, never attendee rows (§3.3)
// ---------------------------------------------------------------------------

export interface EventAttendanceCounts {
  going: number;
  interested: number;
  waitlist: number;
  /** Host-only; `null` for everybody else, because queue depth is the host's business. */
  pending: number | null;
  capacity: number | null;
  /** `null` when capacity is unlimited. Never negative, even past a host override. */
  seatsRemaining: number | null;
  isFull: boolean;
  /**
   * How many verified meetings are tagged to this event — "23 people met
   * someone new here". A plain number, visible to everybody who can see the
   * event rather than host-gated like `pending`, because unlike queue depth it
   * is a fact about the event and not about any individual: it names nobody and
   * pairs nobody with anybody (20260814190000).
   *
   * Counts *meetings*, which never move, not live connections, which either
   * party may later remove. So this and `getOwnConnectionsAtEvent` below answer
   * slightly different questions and may legitimately disagree — see that
   * function's comment.
   */
  connectionsMade: number;
}

/**
 * The numbers an event page shows. `null` when the caller cannot see the event
 * — the RPC's refusal, passed through rather than turned into an exception,
 * because "you cannot see this" is the same answer `getEventForViewer` gives by
 * returning nothing.
 */
export async function getEventAttendanceCounts(
  supabase: SupabaseClient,
  eventId: string,
): Promise<EventAttendanceCounts | null> {
  const { data, error } = await supabase.rpc("event_attendance_counts", { p_event_id: eventId });

  if (error) {
    throw new Error(`Failed to load attendance for this event: ${error.message}`, { cause: error });
  }

  const result = data as Record<string, unknown> | null;
  if (!result || result.ok !== true) {
    return null;
  }

  return {
    going: Number(result.going ?? 0),
    interested: Number(result.interested ?? 0),
    waitlist: Number(result.waitlist ?? 0),
    pending: result.pending === null || result.pending === undefined ? null : Number(result.pending),
    capacity: result.capacity === null || result.capacity === undefined ? null : Number(result.capacity),
    seatsRemaining:
      result.seats_remaining === null || result.seats_remaining === undefined
        ? null
        : Number(result.seats_remaining),
    isFull: result.is_full === true,
    // Defaulted like `going`/`interested` rather than nullable like `pending`:
    // the RPC always returns a number here for a caller who can see the event,
    // and the `?? 0` is for the one case that outlives any single deploy — a
    // client running against a database where this migration has not been
    // applied yet. "No answer" reads as zero, not as `NaN` on a page.
    connectionsMade: Number(result.connections_made ?? 0),
  };
}

/**
 * "How many people did *I* personally connect with at this event" — the
 * caller's own number, never anybody else's.
 *
 * WHY THIS NEEDS NO RPC, NO NEW GRANT AND NO NEW POLICY
 *
 * Unlike `getEventAttendanceCounts` above, this question is answerable entirely
 * from rows the caller may already read, so making it a `security definer`
 * function would add a privileged code path to compute something unprivileged.
 * Both halves were verified against the live database in a rolled-back
 * transaction before this was written, rather than assumed:
 *
 *   - `connections`: the "you can read only your own edges" policy
 *     (20260809211200) returns exactly the caller's own edges. A fourth user's
 *     connection made at this same event does not come back — confirmed by
 *     simulating four separate sessions, not by reading the policy alone.
 *   - `meetings`: `private.can_see_meeting()`'s participant branch is
 *     unconditional, so a participant always reads their own meeting row
 *     including its `event_id`, whatever privacy flags are set.
 *
 * WHY IT STARTS FROM CONNECTIONS AND NOT FROM MEETINGS
 *
 * This is the part that looks like an unnecessary detour and is not. The
 * obvious one-query version — "count the meetings I can see whose `event_id` is
 * this event" — is wrong, and the live check demonstrated it: a viewer who is a
 * mutual of both parties of somebody *else's* meeting can read that meeting row
 * too (`can_see_meeting`'s Path B, the triadic feed post), so the naive count
 * returned 2 for a user who personally made 1 connection there. Anchoring on
 * the caller's own `connections` rows and using the meetings only to look up
 * `event_id` is what makes the number mean "mine".
 *
 * Two queries and a `.in(...)` batch, the same shape as `listOwnConnections` in
 * `connections-service.ts` and `listAttendingEvents` above, so this stays two
 * round trips no matter how many connections the caller has.
 *
 * `userId` is not needed to *scope* the result — RLS has already done that — and
 * is used only to re-check each returned edge really is the caller's, the same
 * belt-and-braces posture the rest of the service layer takes. A row that
 * somehow failed that check would be dropped rather than counted.
 *
 * COUNTS `active` EDGES, so it is "connections I still have from this event",
 * and it will fall if the caller later removes one. That is the right reading
 * for a personal number and it is deliberately *not* the same rule as
 * `connectionsMade` above, which counts meetings and therefore never falls. The
 * two disagreeing is expected, not a bug in either.
 *
 * Note what this deliberately does not do: it never touches `events`, so it
 * neither needs nor checks `can_see_event`. Asking about an event the caller
 * cannot see is answerable and harmless — the answer is derived purely from the
 * caller's own meetings, whose `event_id` `getMeetingRecord` already hands them
 * — so it discloses nothing they could not already read, and it cannot be used
 * to probe whether an arbitrary event id exists: an unknown id and an invisible
 * one both return 0, exactly like an event the caller simply did not connect
 * with anyone at.
 */
export async function getOwnConnectionsAtEvent(
  supabase: SupabaseClient,
  eventId: string,
  userId: string,
): Promise<number> {
  const { data: connections, error: connectionsError } = await supabase
    .from("connections")
    .select("id, user_a_id, user_b_id, origin_meeting_id")
    .eq("status", "active");

  if (connectionsError) {
    throw new Error(`Failed to load your connections: ${connectionsError.message}`, {
      cause: connectionsError,
    });
  }
  if (!connections || connections.length === 0) {
    return 0;
  }

  const ownMeetingIds = connections
    .filter((c) => c.user_a_id === userId || c.user_b_id === userId)
    .map((c) => c.origin_meeting_id as string);

  if (ownMeetingIds.length === 0) {
    return 0;
  }

  // Rows and `.length`, not PostgREST's `head`/`count=exact`. The two are
  // equivalent here and the counting form transfers less, but the row form is
  // the one whose behaviour under these policies was actually checked against
  // the live database, and it is the form the rest of this file and
  // `listOwnConnections` already use. The set is bounded by the caller's own
  // connection count, so there is nothing to save at pilot scale.
  const { data: meetings, error: meetingsError } = await supabase
    .from("meetings")
    .select("id")
    .eq("event_id", eventId)
    .in("id", ownMeetingIds);

  if (meetingsError) {
    throw new Error(`Failed to load your connections at this event: ${meetingsError.message}`, {
      cause: meetingsError,
    });
  }
  return (meetings ?? []).length;
}

/**
 * "3 going, 2 interested" over the caller's *own connections* — Q21's two
 * separately-labelled counts, never one combined number.
 *
 * The RPC returns only people already in the caller's graph, so this cannot be
 * used to enumerate an event's attendees; and it is a display answer, not a
 * gate. `private.shares_event_with()` — the branch of the `users` read policy
 * that decides whether two *unconnected* people may read each other's profiles
 * — still requires `going` on both sides and is untouched by this. Anybody
 * tempted to reuse this function as a visibility check should read the §2.6
 * amendment first: it is one refactor away from converting a display change
 * into a visibility change.
 */
export async function getConnectionsAttending(
  supabase: SupabaseClient,
  eventId: string,
): Promise<ConnectionsAttendingSummary> {
  const { data, error } = await supabase.rpc("connections_attending", { p_event_id: eventId });

  if (error) {
    throw new Error(`Failed to load who you know at this event: ${error.message}`, { cause: error });
  }

  return summarizeConnectionsAttending((data ?? []) as { user_id: string; status: string }[]);
}

export interface HostQueueEntry {
  rsvpId: string;
  userId: string;
  status: RsvpStatus;
  respondedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  capacityOverride: boolean;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  photoPath: string | null;
}

/**
 * The host's roster for their own event: everyone `pending`, `waitlist` or
 * `going`, with the profile fields needed to decide about them.
 *
 * Returns an empty list — not an error — for anybody who is not the host, which
 * is the RPC's own behaviour passed straight through.
 *
 * This is the one place in the Events feature that shows a caller profile
 * fields for people they may not otherwise be able to read, and it is contained
 * in a function precisely so that it cannot become a general visibility rule:
 * the alternative considered and rejected was a new branch on the `users` read
 * policy (§3.4), which would have applied to every query against `users`
 * anywhere in the app, forever. `interested`, `not_going` and `denied` rows are
 * deliberately not included — the migration header explains each exclusion.
 */
export async function getHostRsvpQueue(
  supabase: SupabaseClient,
  eventId: string,
): Promise<HostQueueEntry[]> {
  const { data, error } = await supabase.rpc("event_rsvp_queue", { p_event_id: eventId });

  if (error) {
    throw new Error(`Failed to load the RSVP queue: ${error.message}`, { cause: error });
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    rsvpId: row.rsvp_id as string,
    userId: row.user_id as string,
    status: row.status as RsvpStatus,
    respondedAt: row.responded_at as string,
    decidedAt: (row.decided_at as string | null) ?? null,
    decidedBy: (row.decided_by as string | null) ?? null,
    capacityOverride: row.capacity_override === true,
    firstName: (row.first_name as string | null) ?? null,
    lastName: (row.last_name as string | null) ?? null,
    username: (row.username as string | null) ?? null,
    photoPath: (row.photo_path as string | null) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Event mutations — ordinary RLS-checked writes
// ---------------------------------------------------------------------------

/**
 * Creates an event hosted by the caller. Q5, resolved: any signed-in user may.
 *
 * `hostUserId` is a separate argument rather than a field of `input` because it
 * must come from the session, never from client input — the same arrangement
 * `addOwnSocialLink` uses for `user_id`. The INSERT policy's `with check`
 * (`host_user_id = private.current_user_id()`) would refuse a mismatch anyway;
 * this is that rule enforced one layer earlier, where it produces a clearer
 * failure than a policy violation.
 */
export async function createEvent(
  supabase: SupabaseClient,
  hostUserId: string,
  input: EventInsert,
): Promise<EventRow> {
  const parsed = eventInsertSchema.parse(input);

  const { data, error } = await supabase
    .from("events")
    .insert({ ...parsed, host_user_id: hostUserId })
    .select(
      "id, host_user_id, city_id, title, description, starts_at, ends_at, timezone, venue_name, venue_address, latitude, longitude, visibility, capacity, requires_approval, cover_image_path, created_at",
    )
    .single<EventRow>();

  if (error) {
    throw new Error(`Failed to create the event: ${error.message}`, { cause: error });
  }
  return data;
}

/**
 * Edits an event the caller hosts. The `.eq("host_user_id", userId)` filter
 * duplicates what the UPDATE policy already enforces — the same belt-and-braces
 * posture the rest of this codebase's service layer takes, so a bug that lost
 * the session-derived id still cannot edit somebody else's event.
 *
 * Raising `capacity` here can promote people off the waitlist, by an AFTER
 * UPDATE trigger in the database rather than by anything in this function
 * (20260814051200). That is why the promotion is not visible in this code: it
 * has to happen in the same transaction as the capacity change, and a hook in
 * TypeScript could not guarantee that.
 */
export async function updateOwnEvent(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
  update: EventUpdate,
): Promise<void> {
  const parsed = eventUpdateSchema.parse(update);

  const { data, error } = await supabase
    .from("events")
    .update(parsed)
    .eq("id", eventId)
    .eq("host_user_id", userId)
    .select("id");

  if (error) {
    throw new Error(`Failed to update the event: ${error.message}`, { cause: error });
  }
  if (!data || data.length === 0) {
    throw new Error("That event couldn't be updated — you may not be its host.");
  }
}

// ---------------------------------------------------------------------------
// Private-event invites — ordinary RLS-checked writes, and deliberately so
// ---------------------------------------------------------------------------

/**
 * Invites somebody to see a private event.
 *
 * Unlike every RSVP mutation in this file, this is a plain insert rather than an
 * RPC, and the difference is principled rather than incidental. The RSVP RPCs
 * exist because `going` is a *computed outcome* — it depends on capacity, on the
 * approval gate, and on a lock over the event — so a client-asserted value would
 * be a client-asserted privilege. An invite has no computed component at all: it
 * is one row, and every rule about it is a question the INSERT policy can answer
 * on its own. Wrapping it in a `security definer` function would move the
 * authorization out of the policy layer without making it any stricter.
 *
 * What the policy enforces, none of which is re-implemented here:
 *   - `invited_by_user_id` must be the caller (act as yourself);
 *   - the invitee must be an existing *connection* of the inviter
 *     (`private.are_connected`) — the security-relevant condition, since an
 *     event's population feeds the `users` read policy once two people are both
 *     `going`, and without it a private event would be a way to pull a stranger
 *     into that rule with no tap and no scan;
 *   - the caller must be the host or hold a `going` RSVP;
 *   - and you cannot invite yourself (policy *and* a CHECK constraint).
 *
 * `invitedByUserId` is a separate argument rather than part of an input object,
 * for the same reason `createEvent` takes `hostUserId` separately: it must come
 * from the session and never from client input. The policy would refuse a
 * mismatch anyway; passing it explicitly enforces the rule one layer earlier,
 * where it reads as intent rather than as a policy violation.
 *
 * Idempotent by design: inviting the same person twice is a no-op rather than an
 * error a UI has to explain. Note the deliberate consequence — a repeat invite
 * does not overwrite `invited_by_user_id`, so the row keeps whoever opened the
 * door first.
 *
 * That idempotency is a plain `.insert()` whose unique violation (23505,
 * `event_invites_one_per_user_per_event`) is swallowed, rather than `.upsert()`
 * with `ignoreDuplicates`. The reason is a permission one, not a stylistic one:
 * `authenticated` holds INSERT and SELECT on this table and deliberately no
 * UPDATE grant at all, so an upsert that resolved to a merge instead of
 * `ON CONFLICT DO NOTHING` would fail with a permission error at runtime rather
 * than quietly doing the right thing. Catching the constraint by name depends
 * only on SQL semantics that cannot drift.
 *
 * Note which error is swallowed and which is not: 23505 means the invite already
 * exists, which is the caller's desired end state. A policy refusal is 42501 and
 * still throws — "you are not allowed to invite this person" must never be
 * silently reported as success.
 *
 * This grants visibility only. It creates no RSVP — the invitee still answers
 * for themselves, which is the invariant that keeps `shares_event_with()` safe.
 */
export async function inviteToEvent(
  supabase: SupabaseClient,
  eventId: string,
  invitedByUserId: string,
  invitedUserId: string,
): Promise<void> {
  const { error } = await supabase.from("event_invites").insert({
    event_id: eventId,
    invited_user_id: invitedUserId,
    invited_by_user_id: invitedByUserId,
  });

  // Already invited — the end state the caller wanted, reached earlier.
  if (error && error.code === "23505") {
    return;
  }
  if (error) {
    throw new Error(`Failed to send the invite: ${error.message}`, { cause: error });
  }
}

/**
 * The invites for one event.
 *
 * No ownership filter and no role check, because RLS already scopes the answer
 * and doing it twice here would only invent a second, weaker copy of the rule: a
 * host gets every invite to their own event, an inviter gets the ones they sent,
 * an invitee gets their own, and anybody else gets an empty list rather than an
 * error. That is the same posture `getHostRsvpQueue` takes for a non-host.
 */
export async function listEventInvites(
  supabase: SupabaseClient,
  eventId: string,
): Promise<EventInviteRow[]> {
  const { data, error } = await supabase
    .from("event_invites")
    .select("id, event_id, invited_user_id, invited_by_user_id, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load the invites for this event: ${error.message}`, { cause: error });
  }
  return (data ?? []) as EventInviteRow[];
}

// ---------------------------------------------------------------------------
// RSVP mutations — every one of these is an RPC, and that is the design
// ---------------------------------------------------------------------------

/**
 * What the RSVP RPCs answer with. A refusal is an ordinary result rather than
 * an exception, because "that event is full" and "the host has to approve this"
 * are things to tell a person, not stack traces. The `reason` codes are the
 * database's own vocabulary, passed through unchanged so there is one list to
 * keep in step rather than two.
 */
export type RsvpMutationResult =
  | {
      ok: true;
      /**
       * The status now stored — `null` after a withdrawal, which leaves no row
       * and therefore no answer. Rendering `null` as `not_going` would state
       * something the person did not say.
       */
      status: RsvpStatus | null;
      /** The status a withdrawal removed, so the UI can say what it undid. */
      withdrewFromStatus: RsvpStatus | null;
      changed: boolean;
      /** How many people the database promoted off the waitlist as a result. */
      promoted: number;
    }
  | { ok: false; reason: string };

/**
 * Express an intent about an event: `going`, `interested` or `not_going`.
 *
 * The *stored* status may differ from what was asked, and that is the whole
 * point of routing this through `public.request_event_rsvp`: an approval-gated
 * event stores `pending`, a full one stores `waitlist`. Callers should render
 * the returned `status`, not the intent they sent — the two disagreeing is the
 * normal case, not an error.
 */
export async function requestRsvp(
  supabase: SupabaseClient,
  eventId: string,
  intent: RsvpIntent,
): Promise<RsvpMutationResult> {
  const { data, error } = await supabase.rpc("request_event_rsvp", {
    p_event_id: eventId,
    p_status: intent,
  });

  if (error) {
    throw new Error(`Failed to record your RSVP: ${error.message}`, { cause: error });
  }
  return asRsvpResult(data);
}

/**
 * Removes the caller's answer entirely — distinct from answering `not_going`,
 * which is an answer. If this frees a seat, the longest-waiting person is
 * promoted inside the same database transaction, which is why withdrawal is an
 * RPC rather than the plain DELETE it replaced.
 */
export async function withdrawRsvp(
  supabase: SupabaseClient,
  eventId: string,
): Promise<RsvpMutationResult> {
  const { data, error } = await supabase.rpc("withdraw_event_rsvp", { p_event_id: eventId });

  if (error) {
    throw new Error(`Failed to withdraw your RSVP: ${error.message}`, { cause: error });
  }
  return asRsvpResult(data);
}

/**
 * A host approving or denying somebody else's request for their own event.
 *
 * `override` admits past a full event's cap and is recorded on the row
 * (`capacity_override`) so an over-capacity event is explainable afterwards.
 * Whether the caller is really the host is decided by the database, not here:
 * the RPC looks the RSVP up joined to its event with `host_user_id = caller`,
 * and answers `rsvp_not_found` for both "no such RSVP" and "not your event" so
 * this cannot be used to probe whether an id is real.
 */
export async function decideRsvp(
  supabase: SupabaseClient,
  rsvpId: string,
  decision: RsvpDecision,
  override = false,
): Promise<RsvpMutationResult> {
  const { data, error } = await supabase.rpc("decide_event_rsvp", {
    p_rsvp_id: rsvpId,
    p_decision: decision,
    p_override: override,
  });

  if (error) {
    throw new Error(`Failed to record your decision: ${error.message}`, { cause: error });
  }
  return asRsvpResult(data);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * PostgREST returns an embedded one-to-one relation as a nested object (or, for
 * some shapes, a one-element array). Normalising it here keeps every caller
 * from having to know which, and keeps `BrowseEventItem` a flat, predictable
 * shape for whoever builds the UI.
 */
function splitEmbeddedCity(row: Record<string, unknown>): BrowseEventItem {
  const { cities, ...event } = row;
  const city = (Array.isArray(cities) ? cities[0] : cities) as BrowseEventItem["city"];
  return { event: event as unknown as EventRow, city };
}

/** Narrows the RPC's jsonb answer without inventing a success it did not report. */
function asRsvpResult(data: unknown): RsvpMutationResult {
  const result = data as Record<string, unknown> | null;

  if (!result || result.ok !== true) {
    return { ok: false, reason: String(result?.reason ?? "unknown_error") };
  }
  return {
    ok: true,
    status: (result.status as RsvpStatus | undefined) ?? null,
    // `withdraw_event_rsvp` reports the status it removed rather than a new one.
    withdrewFromStatus: (result.withdrew_from_status as RsvpStatus | undefined) ?? null,
    changed: result.changed !== false,
    promoted: Number(result.promoted ?? 0),
  };
}
