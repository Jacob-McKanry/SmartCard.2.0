/**
 * `public.blocks` — see 20260809210600_table_connections_and_blocks.sql
 *
 * Readable only by the blocker. There is deliberately no way for the blocked
 * person to discover the row: telling someone they have been blocked is both a
 * safety problem and an invitation to work around it.
 */
import { z } from "zod";

import { timestamptzSchema, uuidSchema } from "./scalars";

export const blockRowSchema = z.object({
  blocker_user_id: uuidSchema,
  blocked_user_id: uuidSchema,
  created_at: timestamptzSchema,
  reason: z.string().nullable(),
});

export type BlockRow = z.infer<typeof blockRowSchema>;
