import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardRow, UserRow } from "@smartcard/types";

/**
 * The service layer (§1.7) for the Activity page — the in-app record from
 * Q28 (architecture §9, §4.5's amendment). §4.5's own words for why this
 * exists: the push notification is a best-effort channel ("push delivery is
 * best-effort on both platforms and users disable notifications"), so a user
 * who never receives one still needs a path to detection. This is that path.
 *
 * Every function here takes the caller's own RLS-bound `SupabaseClient` —
 * never the service role — matching `connections-service.ts`'s posture:
 * `connection_sessions` already grants presenters SELECT on their own rows
 * (`20260809211200_rls_policies_graph_and_meetings.sql`), and `cards` already
 * grants owners SELECT on their own rows (`20260809211100`), so there is no
 * reason this feature needs to bypass RLS to read either one.
 */

export interface CardTapActivityItem {
  sessionId: string;
  tapper: Pick<UserRow, "id" | "first_name" | "last_name" | "username" | "photo_path">;
  consumedAt: string;
  /**
   * Null when the connection this tap created is no longer active (already
   * removed) or, in principle, missing — same "fail closed, skip the row's
   * action rather than guess" posture `listOwnConnections` uses. The tap
   * itself still renders; only the "remove connection" action is withheld.
   */
  connectionId: string | null;
}

/**
 * Every card tap of the caller's own card(s), newest first — the in-app half
 * of the detection control §4.5's amendment describes, sourced from the same
 * table the push notification's coalescing count already reads
 * (`connection_sessions`, `method = 'nfc_card'`). No second source of truth.
 *
 * Capped at 50 rows, no pagination — the same sane-cap judgment call the
 * meeting feed makes (§2.9), for the same reason: nothing about this pilot's
 * scale needs real pagination machinery yet.
 */
export async function listCardTapActivity(
  supabase: SupabaseClient,
  userId: string,
): Promise<CardTapActivityItem[]> {
  const { data: sessions, error: sessionsError } = await supabase
    .from("connection_sessions")
    .select("id, consumed_by_user_id, consumed_at")
    .eq("method", "nfc_card")
    .eq("presenter_user_id", userId)
    .eq("status", "consumed")
    .order("consumed_at", { ascending: false })
    .limit(50);

  if (sessionsError) {
    throw new Error(`Failed to load card-tap activity: ${sessionsError.message}`, {
      cause: sessionsError,
    });
  }
  if (sessions.length === 0) {
    return [];
  }

  const tapperIds = [...new Set(sessions.map((s) => s.consumed_by_user_id).filter((id): id is string => id !== null))];

  const [{ data: users, error: usersError }, { data: connections, error: connectionsError }] =
    await Promise.all([
      supabase
        .from("users")
        .select("id, first_name, last_name, username, photo_path")
        .in("id", tapperIds),
      // No explicit user_a_id/user_b_id filter, matching `listOwnConnections`:
      // the `connections` select policy already scopes every row returned to
      // one where the caller is a party, so there is nothing this query could
      // add by filtering again.
      supabase.from("connections").select("id, user_a_id, user_b_id").eq("status", "active"),
    ]);

  if (usersError) {
    throw new Error(`Failed to load tapper profiles: ${usersError.message}`, { cause: usersError });
  }
  if (connectionsError) {
    throw new Error(`Failed to load connections: ${connectionsError.message}`, {
      cause: connectionsError,
    });
  }

  const usersById = new Map(users.map((u) => [u.id, u]));
  // A tap's counterpart is one specific person; there is at most one active
  // connection between the caller and any other single user (§2.3's
  // uniqueness constraint on the pair), so this map is safe to key by the
  // other user's id alone.
  const connectionIdByOtherUser = new Map(
    connections.map((c) => [c.user_a_id === userId ? c.user_b_id : c.user_a_id, c.id]),
  );

  return sessions.flatMap((session): CardTapActivityItem[] => {
    if (session.consumed_by_user_id === null || session.consumed_at === null) {
      // The `connection_sessions_consumed_is_attributed` constraint makes
      // this untrue in practice for a `consumed` row — fails closed (skips
      // the row) rather than assuming the invariant holds, same posture
      // `listOwnConnections` takes for its own FK invariants.
      return [];
    }
    const tapper = usersById.get(session.consumed_by_user_id);
    if (!tapper) {
      return [];
    }
    return [
      {
        sessionId: session.id,
        tapper,
        consumedAt: session.consumed_at,
        connectionId: connectionIdByOtherUser.get(tapper.id) ?? null,
      },
    ];
  });
}

/** The caller's own cards that are currently tappable — the ones a revoke action is meaningful for. */
export async function listOwnAssignedCards(
  supabase: SupabaseClient,
  userId: string,
): Promise<Pick<CardRow, "id" | "card_code">[]> {
  const { data, error } = await supabase
    .from("cards")
    .select("id, card_code")
    .eq("owner_user_id", userId)
    .eq("status", "assigned")
    .order("assigned_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load your cards: ${error.message}`, { cause: error });
  }
  return data;
}
