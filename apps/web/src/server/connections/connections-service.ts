import "server-only";

import { UserFacingError } from "@/server/errors";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  meetingParticipantConsentUpdateSchema,
  meetingPrivacyUpdateSchema,
  type ConnectionRow,
  type MeetingLocationRow,
  type MeetingParticipantConsentUpdate,
  type MeetingParticipantRow,
  type MeetingPrivacyUpdate,
  type MeetingRow,
  type UserRow,
} from "@smartcard/types";

/**
 * The service layer (§1.7) for "Mutual connections + meeting record"
 * (README build order item 3). Every function here takes the caller's own
 * RLS-bound `SupabaseClient` — never the service role — for the same reason
 * `apps/web/src/server/profile/profile-service.ts` does: there is no reason
 * this feature needs to bypass RLS, and every mutation below is additionally
 * filtered by the caller's own id even though the policy already restricts
 * it, matching that file's belt-and-braces posture.
 *
 * WHAT THIS FILE DOES NOT DO, ON PURPOSE
 *
 * There is no function anywhere here that inserts into `connections`,
 * `meetings`, `meeting_participants` or `meeting_locations` — only reads and
 * the three narrow updates the RLS grants in
 * `20260809211200_rls_policies_graph_and_meetings.sql` actually allow
 * (`connections.status` one-way active->removed; `meetings.location_visibility`;
 * `meeting_participants.location_share_consent` / `marked_private`). That
 * migration is the single source of truth for what a client may change about
 * the social graph, and this file was written by reading it, not by assuming
 * it — see the build report for the exact grants each function below maps to.
 */

// ---------------------------------------------------------------------------
// Connections list
// ---------------------------------------------------------------------------

export interface ConnectionListItem {
  connectionId: string;
  otherUser: Pick<UserRow, "id" | "first_name" | "last_name" | "username" | "photo_path">;
  occurredAt: string;
  verificationMethod: MeetingRow["verification_method"];
}

/**
 * Every `active` connection the caller has, newest first.
 *
 * Three queries, not a PostgREST embed: `connections` names the other user
 * only implicitly (whichever of `user_a_id`/`user_b_id` isn't the caller) and
 * names the meeting by id, so getting both in one embedded call would need a
 * dynamic column reference PostgREST doesn't do. Batching the follow-up
 * `users`/`meetings` lookups with `.in(...)` keeps this at three round trips
 * total regardless of how many connections the caller has, rather than one
 * per row.
 */
export async function listOwnConnections(
  supabase: SupabaseClient,
  userId: string,
): Promise<ConnectionListItem[]> {
  const { data: connections, error: connectionsError } = await supabase
    .from("connections")
    .select("id, user_a_id, user_b_id, origin_meeting_id, status, created_at")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (connectionsError) {
    throw new Error(`Failed to load connections: ${connectionsError.message}`, {
      cause: connectionsError,
    });
  }
  if (connections.length === 0) {
    return [];
  }

  const otherUserIds = connections.map((c) => (c.user_a_id === userId ? c.user_b_id : c.user_a_id));
  const meetingIds = connections.map((c) => c.origin_meeting_id);

  const [{ data: users, error: usersError }, { data: meetings, error: meetingsError }] =
    await Promise.all([
      supabase
        .from("users")
        .select("id, first_name, last_name, username, photo_path")
        .in("id", otherUserIds),
      supabase.from("meetings").select("id, occurred_at, verification_method").in("id", meetingIds),
    ]);

  if (usersError) {
    throw new Error(`Failed to load connection profiles: ${usersError.message}`, { cause: usersError });
  }
  if (meetingsError) {
    throw new Error(`Failed to load origin meetings: ${meetingsError.message}`, {
      cause: meetingsError,
    });
  }

  const usersById = new Map(users.map((u) => [u.id, u]));
  const meetingsById = new Map(meetings.map((m) => [m.id, m]));

  // A missing user or meeting row here would mean a connection whose
  // counterpart or origin evidence disappeared out from under an active edge
  // — the FK constraints (`ON DELETE CASCADE`/`RESTRICT`, §2.3) make that
  // untrue in practice, but the fetch fails closed (skips the row rather than
  // rendering a half-populated card) instead of assuming the invariant holds.
  return connections.flatMap((connection): ConnectionListItem[] => {
    const otherUserId = connection.user_a_id === userId ? connection.user_b_id : connection.user_a_id;
    const otherUser = usersById.get(otherUserId);
    const meeting = meetingsById.get(connection.origin_meeting_id);
    if (!otherUser || !meeting) {
      return [];
    }
    return [
      {
        connectionId: connection.id,
        otherUser,
        occurredAt: meeting.occurred_at,
        verificationMethod: meeting.verification_method,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Meeting-record detail
// ---------------------------------------------------------------------------

/**
 * A single connection by id, or `null` if it doesn't exist *or* the caller
 * isn't a party to it. Those two cases are indistinguishable on purpose: the
 * `connections` select policy (`20260809211200`) already makes "not yours"
 * and "doesn't exist" produce the same empty result, and preserving that here
 * — rather than, say, using the service role to tell them apart for a nicer
 * error message — would mean this function could confirm a connection id's
 * existence to someone who isn't part of it. Not itself sensitive data, but
 * not this function's business to reveal either.
 */
export async function getConnectionForViewer(
  supabase: SupabaseClient,
  connectionId: string,
): Promise<ConnectionRow | null> {
  const { data, error } = await supabase
    .from("connections")
    .select("id, user_a_id, user_b_id, origin_meeting_id, status, created_at")
    .eq("id", connectionId)
    .maybeSingle<ConnectionRow>();

  if (error) {
    throw new Error(`Failed to load connection: ${error.message}`, { cause: error });
  }
  return data;
}

export async function getMeetingRecord(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<MeetingRow | null> {
  const { data, error } = await supabase
    .from("meetings")
    .select("id, occurred_at, verification_method, verification_session_id, event_id, is_private, location_visibility, created_at")
    .eq("id", meetingId)
    .maybeSingle<MeetingRow>();

  if (error) {
    throw new Error(`Failed to load meeting: ${error.message}`, { cause: error });
  }
  return data;
}

/**
 * Both participant rows of a meeting the caller was at. The
 * `meeting_participants` select policy (§3.2/`20260809211200`) lets a
 * participant read every row of a meeting they're in, specifically so a
 * screen like this one can show "waiting on [them]" using the other party's
 * real consent value rather than guessing at it.
 */
export async function getMeetingParticipants(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<MeetingParticipantRow[]> {
  const { data, error } = await supabase
    .from("meeting_participants")
    .select("meeting_id, user_id, location_share_consent, marked_private")
    .eq("meeting_id", meetingId);

  if (error) {
    throw new Error(`Failed to load meeting participants: ${error.message}`, { cause: error });
  }
  return data;
}

/**
 * The meeting's captured coordinates, or `null` if none were captured
 * (every `nfc_card` meeting, and any `qr_gps` meeting where geocoding/GPS
 * simply wasn't recorded) — see the header comment on
 * `packages/types/src/db/meeting-locations.ts`: absence of a row *is* "no
 * location", not an error state.
 *
 * Reached only for meetings the caller participated in (the page that calls
 * this always resolves the meeting through the caller's own connection
 * first), so the participant branch of the §3.2 policy is what's actually in
 * force here — not the mutuals branch, which this feature does not exercise.
 */
export async function getMeetingLocation(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<MeetingLocationRow | null> {
  const { data, error } = await supabase
    .from("meeting_locations")
    .select("meeting_id, latitude, longitude, accuracy_m, place_label")
    .eq("meeting_id", meetingId)
    .maybeSingle<MeetingLocationRow>();

  if (error) {
    throw new Error(`Failed to load meeting location: ${error.message}`, { cause: error });
  }
  return data;
}

/**
 * The other participant's profile, for display. Only ever called with the
 * id of someone the caller already shares an active connection with, so the
 * `users` select policy's `are_connected` branch (§3.4) is what allows this
 * to return a row — this function does not, and could not, fetch an
 * arbitrary stranger's profile.
 */
export async function getOtherParticipantProfile(
  supabase: SupabaseClient,
  otherUserId: string,
): Promise<Pick<UserRow, "id" | "first_name" | "last_name" | "username" | "photo_path"> | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id, first_name, last_name, username, photo_path")
    .eq("id", otherUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load the other participant's profile: ${error.message}`, {
      cause: error,
    });
  }
  return data;
}

// ---------------------------------------------------------------------------
// Mutations — each one maps to exactly one column-level UPDATE grant in
// 20260809211200_rls_policies_graph_and_meetings.sql. See the build report
// for the mapping table.
// ---------------------------------------------------------------------------

/**
 * "Share with mutual connections" toggle. Maps to
 * `grant update (is_private, location_visibility) on public.meetings`, used
 * here for `location_visibility` only — this feature does not expose a
 * control for `is_private` (see the build report's judgment-call note).
 * Either participant may call this; the RLS policy does not distinguish
 * which one is asking, and neither does this function.
 */
export async function setMeetingLocationVisibility(
  supabase: SupabaseClient,
  meetingId: string,
  update: MeetingPrivacyUpdate,
): Promise<void> {
  const parsed = meetingPrivacyUpdateSchema.parse(update);

  const { error } = await supabase.from("meetings").update(parsed).eq("id", meetingId);

  if (error) {
    throw new Error(`Failed to update meeting sharing setting: ${error.message}`, { cause: error });
  }
}

/**
 * The caller's own consent / mark-private flags. Maps to
 * `grant update (location_share_consent, marked_private) on public.meeting_participants`,
 * scoped to the caller's own row by both the RLS policy and the explicit
 * `.eq("user_id", userId)` filter below — the same belt-and-braces posture
 * `profile-service.ts` uses, so a bug that forgot to derive `userId` from the
 * session would still be caught by RLS rather than silently editing someone
 * else's row.
 */
export async function setOwnParticipantFlags(
  supabase: SupabaseClient,
  meetingId: string,
  userId: string,
  update: MeetingParticipantConsentUpdate,
): Promise<void> {
  const parsed = meetingParticipantConsentUpdateSchema.parse(update);

  const { error } = await supabase
    .from("meeting_participants")
    .update(parsed)
    .eq("meeting_id", meetingId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update your meeting privacy setting: ${error.message}`, {
      cause: error,
    });
  }
}

/**
 * Removes a connection: `status: 'active' -> 'removed'`, the one transition
 * `20260809211200`'s "either party may remove their own connection" policy
 * allows. The `.eq("status", "active")` filter mirrors the policy's USING
 * clause so a double-submit (already removed) fails loudly here instead of
 * silently no-op-ing — see the thrown error below when zero rows match.
 *
 * There is deliberately no function anywhere in this file that could set
 * `status` back to `active`. That is not an oversight to "complete" later:
 * the policy that would need to allow it does not exist, and CLAUDE.md /
 * the build task are explicit that reconnecting must go through a fresh
 * verified meeting, not a client action.
 */
export async function removeConnection(supabase: SupabaseClient, connectionId: string): Promise<void> {
  const { data, error } = await supabase
    .from("connections")
    .update({ status: "removed" })
    .eq("id", connectionId)
    .eq("status", "active")
    .select("id");

  if (error) {
    throw new Error(`Failed to remove connection: ${error.message}`, { cause: error });
  }
  if (!data || data.length === 0) {
    throw new UserFacingError("This connection couldn't be removed — it may already be gone.");
  }
}
