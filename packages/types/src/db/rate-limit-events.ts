/**
 * `public.rate_limit_events` — see 20260813210200_table_rate_limit_events.sql
 *
 * The append-only log every §4.6 limit is counted from (Q11: a Postgres table,
 * not Redis). Service role only — no policy and no grant to `authenticated`, the
 * same posture as `connection_attempts` and `app_config` (§3.5), because a
 * client that could read it would learn how much budget it has left and a
 * client that could write it could erase its own.
 *
 * This schema exists for server-side code and for tests; nothing that renders to
 * a user should ever hold one of these rows.
 */
import { z } from "zod";

import { timestamptzSchema } from "./scalars";

/**
 * A rate limit is levied against a user, an IP, a card or a session. Closed set,
 * matching the CHECK constraint, because a typo would silently create a second
 * empty counter — i.e. would silently switch the limit off.
 */
export const rateLimitSubjectKindSchema = z.enum(["user", "ip", "card", "session"]);
export type RateLimitSubjectKind = z.infer<typeof rateLimitSubjectKindSchema>;

export const rateLimitEventRowSchema = z.object({
  /** `bigint generated always as identity`. Small enough to be a JS number for the foreseeable life of the table. */
  id: z.number().int(),

  /** Which limit this counts against. Free text in the column: a new endpoint must not need a migration to be limited. */
  action: z.string(),

  subject_kind: rateLimitSubjectKindSchema,

  /** A user id, card id, session id, or HASHED ip — never a raw IP address. */
  subject_key: z.string(),

  occurred_at: timestamptzSchema,
});

export type RateLimitEventRow = z.infer<typeof rateLimitEventRowSchema>;
