import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventRow, MeetingLocationRow, UserRow, VerificationMethod } from "@smartcard/types";

import { classifyFeedMeeting } from "@/app/(app)/feed/classify";

/**
 * The service layer (§1.7) for the meeting feed (README build order item 4).
 *
 * NO FEED TABLE — EVERYTHING HERE IS COMPUTED ON READ
 *
 * Architecture doc §2.9 is explicit: there is no feed table for the pilot.
 * Both post types derive from `meetings` + `meeting_participants` +
 * `connections` at request time. That is why this file has exactly one query
 * that decides *what's in the feed* (`meetings`, filtered by nothing but RLS)
 * and everything else is a batched follow-up lookup — the same
 * three-round-trips-total shape `connections-service.ts`'s
 * `listOwnConnections` uses, for the same reason: `.in(...)` once per related
 * table beats a query per row regardless of how many meetings are in view.
 *
 * THE SECURITY BOUNDARY IS RLS, NOT THIS FILE
 *
 * The `meetings` select below has no `.eq(...)`, no participant filter, no
 * mutual-of-both check written in TypeScript anywhere in this file. It reads
 * `select * from meetings order by occurred_at desc limit N` through the
 * caller's own RLS-bound client, and `private.can_see_meeting()` — verified
 * by reading `20260809211200_rls_policies_graph_and_meetings.sql` and
 * `20260809210900_rls_helper_functions.sql` directly before writing any of
 * this — is what decides which rows come back at all: the viewer's own
 * meetings (Path A) plus meetings of mutuals-of-both that nobody marked
 * private (Path B, the exact mechanism behind the "[A] met [B]" post). This
 * file's only job is turning whatever RLS already decided the viewer may see
 * into the two post shapes the product spec allows — it does not, and must
 * not, re-derive or second-guess that decision.
 *
 * The same reasoning applies to `meeting_locations`: the query below is an
 * ordinary `.select()` with no extra logic, so whatever the §3.2 policy
 * returns (participants always; mutuals only with unanimous consent, opt-in,
 * and no privacy override) is exactly what renders. A meeting with no visible
 * location simply has no row in the map below — that is the expected,
 * majority case for a triadic post, not a bug to work around.
 *
 * And once more for `events`, which the "met at [event]" line needs: the
 * lookup is a plain `.select("id, title")` over the distinct `event_id`s of the
 * meetings already in view, so `private.can_see_event()` decides which titles
 * come back — public events to anyone signed in (§2.6), plus the caller's own,
 * ones they hold an RSVP for, and ones they were invited to (20260814060100).
 * There are therefore two entirely ordinary ways for a feed item's `event` to
 * be null, and neither is an error: the meeting was not tagged to an event at
 * all (today, every meeting — nothing populates `meetings.event_id` yet), or it
 * was tagged to a private event this viewer cannot see. The second case is the
 * one worth naming: a triadic "[A] met [B]" post whose meeting happened at a
 * private event the viewer is not part of renders with no event line rather
 * than being dropped, because the meeting is legitimately visible to them and
 * the event's title is not. Fail closed on the title, not on the post.
 *
 * WHY `users` CAN BE READ FOR BOTH PARTIES OF A TRIADIC POST
 *
 * A "[A] met [B]" post needs both A's and B's profile rows, and the viewer is
 * a mutual of both by construction (that's what "mutual of both" means, and
 * it's what `is_mutual_of_both` inside `can_see_meeting` already required to
 * surface the post at all). The `users` select policy
 * (`20260809211100_rls_policies_identity_and_cards.sql`) has an
 * `are_connected(viewer, users.id)` branch — checked directly rather than
 * assumed before writing this file — so both lookups are already permitted
 * by the existing policy; nothing new is needed here.
 */

// ---------------------------------------------------------------------------
// Cap, not pagination
// ---------------------------------------------------------------------------
// Architecture §2.9 sizes the feed around ~337 users total and no feed table
// at all; the task brief's own sizing note is more specific still — pilot
// users have a single-digit number of meetings on day one. A reverse-
// chronological list with a generous fixed cap is proportionate to that
// reality; building cursor pagination or infinite scroll now would be
// complexity aimed at a scale this product doesn't have yet. 50 is chosen as
// "comfortably above what anyone will actually have for a long while, cheap
// to query, cheap to render" — revisit this (real pagination, not just a
// bigger number) once a pilot user's meeting count approaches it. See the
// build report for this same note.
const FEED_ITEM_LIMIT = 50;

type ProfileSummary = Pick<UserRow, "id" | "first_name" | "last_name" | "username" | "photo_path">;

/**
 * Just enough of an event to say where a meeting happened. Deliberately not the
 * whole `EventRow`: the feed is a list of meetings, and a card that carried an
 * event's venue, capacity and cover image would be an events feature growing
 * inside the meeting feed.
 */
type EventSummary = Pick<EventRow, "id" | "title">;

export interface ParticipantFeedItem {
  kind: "participant";
  meetingId: string;
  /** Where to link this item — the existing meeting-record view, never rebuilt here. */
  connectionId: string;
  occurredAt: string;
  verificationMethod: VerificationMethod;
  otherUser: ProfileSummary;
  /** `null` when RLS returned no location row for this meeting — see header. */
  location: MeetingLocationRow | null;
  /**
   * The event this meeting happened at, when it had one and the viewer may see
   * it. `null` is the ordinary case in both directions — see the header. Carried
   * on each variant rather than hoisted into a shared base, matching how
   * `meetingId`, `occurredAt` and `location` are already written here: the
   * discriminated union stays readable as two complete post shapes.
   */
  event: EventSummary | null;
}

export interface MutualFeedItem {
  kind: "mutual";
  meetingId: string;
  occurredAt: string;
  /**
   * The two participants, ordered by display name for stable, readable
   * prose ("Alex met Priya" rather than a render-order coin flip). This
   * ordering carries no meaning about who presented a card or who scanned —
   * that distinction isn't reconstructable here even for a participant (see
   * `connection_sessions`'s RLS: only the presenter can ever read their own
   * session row), and a triadic viewer has no claim to it either way.
   */
  userA: ProfileSummary;
  userB: ProfileSummary;
  location: MeetingLocationRow | null;
  /** See `ParticipantFeedItem.event` — same field, same two null cases. */
  event: EventSummary | null;
}

export type FeedItem = ParticipantFeedItem | MutualFeedItem;

/**
 * Every meeting the caller is entitled to see (per RLS), classified into the
 * two feed post shapes, newest first. See the header comment for exactly
 * where the security boundary is (it is not in this function).
 */
export async function listFeedItems(supabase: SupabaseClient, viewerId: string): Promise<FeedItem[]> {
  const { data: meetings, error: meetingsError } = await supabase
    .from("meetings")
    .select("id, occurred_at, verification_method, event_id")
    .order("occurred_at", { ascending: false })
    .limit(FEED_ITEM_LIMIT);

  if (meetingsError) {
    throw new Error(`Failed to load the feed: ${meetingsError.message}`, { cause: meetingsError });
  }
  if (meetings.length === 0) {
    return [];
  }

  const meetingIds = meetings.map((m) => m.id);

  const { data: participants, error: participantsError } = await supabase
    .from("meeting_participants")
    .select("meeting_id, user_id")
    .in("meeting_id", meetingIds);

  if (participantsError) {
    throw new Error(`Failed to load who was at each meeting: ${participantsError.message}`, {
      cause: participantsError,
    });
  }

  const participantIdsByMeeting = new Map<string, string[]>();
  for (const p of participants) {
    const list = participantIdsByMeeting.get(p.meeting_id) ?? [];
    list.push(p.user_id);
    participantIdsByMeeting.set(p.meeting_id, list);
  }

  // Only meetings the viewer actually participated in need a connection
  // lookup — a triadic post has no connection to link to (the viewer isn't
  // a party to that edge), and this feature offers no such link for it.
  const viewerMeetingIds = meetingIds.filter((id) =>
    (participantIdsByMeeting.get(id) ?? []).includes(viewerId),
  );

  const connectionIdByMeeting = new Map<string, string>();
  if (viewerMeetingIds.length > 0) {
    const { data: connections, error: connectionsError } = await supabase
      .from("connections")
      .select("id, origin_meeting_id")
      .in("origin_meeting_id", viewerMeetingIds);

    if (connectionsError) {
      throw new Error(`Failed to load your connections for the feed: ${connectionsError.message}`, {
        cause: connectionsError,
      });
    }
    for (const c of connections) {
      connectionIdByMeeting.set(c.origin_meeting_id, c.id);
    }
  }

  const allParticipantUserIds = [...new Set(participants.map((p) => p.user_id))];

  // The small set of events the meetings in view actually name. Deduplicated
  // because a night out is one event and many meetings, so the distinct count
  // is normally far below the meeting count — and empty in the common case,
  // which skips the round trip entirely rather than sending `.in("id", [])`.
  const eventIds = [...new Set(meetings.flatMap((m) => (m.event_id ? [m.event_id as string] : [])))];

  const [usersResult, locationsResult, eventsResult] = await Promise.all([
    allParticipantUserIds.length > 0
      ? supabase
          .from("users")
          .select("id, first_name, last_name, username, photo_path")
          .in("id", allParticipantUserIds)
      : Promise.resolve({ data: [] as ProfileSummary[], error: null }),
    supabase
      .from("meeting_locations")
      .select("meeting_id, latitude, longitude, accuracy_m, place_label")
      .in("meeting_id", meetingIds),
    eventIds.length > 0
      ? supabase.from("events").select("id, title").in("id", eventIds)
      : Promise.resolve({ data: [] as EventSummary[], error: null }),
  ]);

  if (usersResult.error) {
    throw new Error(`Failed to load profiles for the feed: ${usersResult.error.message}`, {
      cause: usersResult.error,
    });
  }
  if (locationsResult.error) {
    throw new Error(`Failed to load locations for the feed: ${locationsResult.error.message}`, {
      cause: locationsResult.error,
    });
  }
  if (eventsResult.error) {
    throw new Error(`Failed to load events for the feed: ${eventsResult.error.message}`, {
      cause: eventsResult.error,
    });
  }

  const usersById = new Map((usersResult.data ?? []).map((u) => [u.id, u]));
  const locationsByMeeting = new Map(
    (locationsResult.data ?? []).map((l) => [l.meeting_id, l as MeetingLocationRow]),
  );
  // Keyed by event id rather than by meeting id, unlike the map above: several
  // meetings can share one event, and this is the join for that.
  const eventsById = new Map((eventsResult.data ?? []).map((e) => [e.id as string, e as EventSummary]));

  // Fail closed on anything that doesn't fully resolve, the same posture
  // `listOwnConnections` takes: skip the row rather than render a
  // half-populated post. FK constraints (`ON DELETE CASCADE`/`RESTRICT`)
  // make these branches untrue in practice; the code doesn't assume that.
  return meetings.flatMap((meeting): FeedItem[] => {
    const participantIds = participantIdsByMeeting.get(meeting.id) ?? [];
    const kind = classifyFeedMeeting(participantIds, viewerId);
    const location = locationsByMeeting.get(meeting.id) ?? null;
    // Absent for an untagged meeting and for an event RLS withheld, and the two
    // are deliberately not distinguished: both mean "no event line on this
    // post". Unlike a missing user or connection below, neither skips the item.
    const event = meeting.event_id ? (eventsById.get(meeting.event_id) ?? null) : null;

    if (kind === "participant") {
      const otherUserId = participantIds.find((id) => id !== viewerId);
      const otherUser = otherUserId ? usersById.get(otherUserId) : undefined;
      const connectionId = connectionIdByMeeting.get(meeting.id);
      if (!otherUser || !connectionId) {
        return [];
      }
      return [
        {
          kind: "participant",
          meetingId: meeting.id,
          connectionId,
          occurredAt: meeting.occurred_at,
          verificationMethod: meeting.verification_method,
          otherUser,
          location,
          event,
        },
      ];
    }

    if (kind === "mutual") {
      const [firstId, secondId] = participantIds;
      const first = usersById.get(firstId);
      const second = usersById.get(secondId);
      if (!first || !second) {
        return [];
      }
      // Order by display name rather than destructuring a sorted array —
      // `noUncheckedIndexedAccess` (tsconfig.base.json) would otherwise widen
      // both elements to `ProfileSummary | undefined` even though a two-
      // element sort can never actually drop one.
      const firstSorts = displaySortKey(first).localeCompare(displaySortKey(second)) <= 0;
      const userA = firstSorts ? first : second;
      const userB = firstSorts ? second : first;
      return [
        {
          kind: "mutual",
          meetingId: meeting.id,
          occurredAt: meeting.occurred_at,
          userA,
          userB,
          location,
          event,
        },
      ];
    }

    // kind === null: not a well-formed pairwise meeting. See classify.ts.
    return [];
  });
}

function displaySortKey(user: ProfileSummary): string {
  return `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.id;
}
