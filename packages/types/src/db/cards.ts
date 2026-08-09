/**
 * `public.cards` — see 20260809210200_table_cards.sql
 *
 * Physical NFC card inventory, in the shape settled by Q1 (§2.2): one
 * `card_code`, no separate secret token.
 */
import { z } from "zod";

import { bigintSchema, timestamptzSchema, uuidSchema } from "./scalars";
import { cardStatusSchema } from "./enums";

export const cardRowSchema = z.object({
  id: uuidSchema,

  /**
   * The exact string after `/card/` in the tag URL, e.g. `CUSTOM-f2a930bcb5fe`
   * — a cosmetic prefix plus a 12-hex-character (48-bit) random suffix.
   *
   * Treat this as a secret for any card the caller does not own: it is both the
   * printed label and the value a tap is resolved by, so possessing it is
   * equivalent to possessing the card. The select policy only ever returns rows
   * to their owner for this reason.
   */
  card_code: z.string(),

  status: cardStatusSchema,

  /** Non-null whenever `status` is `assigned` — enforced by a CHECK constraint. */
  owner_user_id: uuidSchema.nullable(),

  assigned_at: timestamptzSchema.nullable(),
  created_at: timestamptzSchema,

  /** Migration traceability only (§6.3). */
  legacy_card_id: bigintSchema.nullable(),
});

export type CardRow = z.infer<typeof cardRowSchema>;
