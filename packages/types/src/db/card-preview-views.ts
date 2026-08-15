/**
 * `public.card_preview_views` — see 20260815120100_table_card_preview_views.sql
 * and 20260815120200_rls_card_preview_views.sql
 *
 * One row per occasion the product showed a cardholder's contact details to
 * somebody with no account: the non-user preview on `/card/<code>` (signed out)
 * and on `/c/<token>` (a phone camera pointed at a presenter's QR).
 *
 * SUCCESSFUL DISCLOSURES ONLY. Refused previews are not in this table — they
 * are already counted in `rate_limit_events`, which records before it counts,
 * so every attempt spends budget whether or not it succeeds. The division is
 * that `rate_limit_events` counts what was ATTEMPTED and this table records
 * what was DISCLOSED; the migration's header explains why duplicating the first
 * into the second would hand an anonymous caller an unbounded write.
 *
 * THIS SCHEMA DESCRIBES THE WHOLE ROW, AND A CLIENT CANNOT READ THE WHOLE ROW.
 * `authenticated` holds SELECT on six columns only — `subject_user_id`,
 * `ip_hash` and `user_agent` are outside the grant on purpose (they are, in
 * order: redundant with the policy, another person's personal data, and
 * attacker-controlled text). `cardPreviewViewOwnerReadSchema` below is the
 * shape a client actually gets back, and it is the one a screen should use.
 * The full `cardPreviewViewRowSchema` is for server-side code and tests.
 */
import { z } from "zod";

import { timestamptzSchema, uuidSchema } from "./scalars";

/**
 * Which entry point resolved the preview. Closed set, matching the CHECK —
 * there are exactly two routes that can produce one, and a third would be a new
 * unauthenticated read path that must not be able to appear without a
 * migration somebody had to write.
 */
export const cardPreviewSourceSchema = z.enum(["card_code", "qr_token"]);
export type CardPreviewSource = z.infer<typeof cardPreviewSourceSchema>;

/**
 * What was handed over: the page was rendered, or the contact file was
 * downloaded. Two separate HTTP requests, two real disclosures, two rows — and
 * they are distinguished because they mean different things to the person being
 * previewed. "Someone opened my card link" is ambient; "someone saved my
 * contact card" is the one they might act on.
 */
export const cardPreviewSurfaceSchema = z.enum(["preview", "vcard"]);
export type CardPreviewSurface = z.infer<typeof cardPreviewSurfaceSchema>;

export const cardPreviewViewRowSchema = z.object({
  /** `bigint generated always as identity`. Nothing references it and nothing is fetched by it. */
  id: z.number().int(),

  viewed_at: timestamptzSchema,

  source: cardPreviewSourceSchema,
  surface: cardPreviewSurfaceSchema,

  /**
   * Whose details were disclosed. NOT NULL — a row that cannot say whose is not
   * an audit record of anything. CASCADE on delete, unlike
   * `connection_attempts`' SET NULL: this table's subject is the person
   * disclosed *about*, so retaining the row after a hard delete would be
   * retaining data about an erased person.
   */
  subject_user_id: uuidSchema,

  /** Set for a `card_code` preview, null for a `qr_token` one. */
  card_id: uuidSchema.nullable(),

  /** Set for a `qr_token` preview, null for a `card_code` one. */
  session_id: uuidSchema.nullable(),

  /** HMAC of the caller's IP with `CONNECT_IP_HASH_SALT`, never a raw address. */
  ip_hash: z.string().nullable(),

  /** Bounded to 512 characters at the application edge before it is stored. */
  user_agent: z.string().nullable(),
});

export type CardPreviewViewRow = z.infer<typeof cardPreviewViewRowSchema>;

/**
 * The six columns `authenticated` may actually SELECT (20260815120200).
 *
 * Mirrors a column-level GRANT rather than a policy, the same way the `*Update`
 * schemas elsewhere in this directory do — so a screen that tries to render a
 * hashed IP is a compile error rather than a query that comes back with a
 * permission failure at runtime.
 */
export const cardPreviewViewOwnerReadSchema = cardPreviewViewRowSchema.pick({
  id: true,
  viewed_at: true,
  source: true,
  surface: true,
  card_id: true,
  session_id: true,
});

export type CardPreviewViewOwnerRead = z.infer<typeof cardPreviewViewOwnerReadSchema>;
