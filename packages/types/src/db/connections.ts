/**
 * `public.connections` — see 20260809210600_table_connections_and_blocks.sql
 *
 * The social graph, mutual by construction. The row always stores the smaller
 * UUID in `user_a_id` (CHECK user_a_id < user_b_id) with a UNIQUE constraint on
 * the pair, which makes a one-directional or duplicate edge impossible to
 * represent at all — follow/following cannot be reintroduced by accident (§2.3).
 *
 * Consumers should not assume `user_a_id` is "the initiator": it is simply the
 * smaller id. Who did the scanning lives on the originating session, not here.
 */
import { z } from "zod";

import { timestamptzSchema, uuidSchema } from "./scalars";
import { connectionStatusSchema } from "./enums";

export const connectionRowSchema = z.object({
  id: uuidSchema,

  /** The smaller of the two user ids. See the note above. */
  user_a_id: uuidSchema,
  /** The larger of the two user ids. */
  user_b_id: uuidSchema,

  /**
   * Non-null: every edge names the meeting that created it, that meeting names
   * the verification session, and that session names the method. An edge with
   * no origin would be one nobody can account for.
   */
  origin_meeting_id: uuidSchema,

  status: connectionStatusSchema,
  created_at: timestamptzSchema,
});

export type ConnectionRow = z.infer<typeof connectionRowSchema>;

/**
 * Canonicalise a pair of user ids the way `connections` stores them.
 *
 * Provided here rather than left to each call site because getting the order
 * wrong turns a lookup into a silent miss — "not connected" when they are — and
 * a silent miss on a connection check fails *open* in some contexts (e.g. "may
 * I show this person's profile?" answered by a different code path). UUIDs are
 * compared as lowercase strings, matching Postgres's ordering of the canonical
 * text form that PostgREST returns.
 */
export function canonicalConnectionPair(
  first: string,
  second: string,
): { user_a_id: string; user_b_id: string } {
  const a = first.toLowerCase();
  const b = second.toLowerCase();
  return a < b ? { user_a_id: a, user_b_id: b } : { user_a_id: b, user_b_id: a };
}
