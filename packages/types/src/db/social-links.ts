/**
 * `public.social_links` — see 20260809210100_table_users_and_social_links.sql
 *
 * Off-platform handles shown on a profile, gated by exactly the same rule as
 * the profile itself. Anything looser would amount to a searchable handle
 * directory, which the product must not have.
 */
import { z } from "zod";

import { integerSchema, timestamptzSchema, uuidSchema } from "./scalars";

export const socialLinkRowSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  platform: z.string(),
  url: z.string(),
  /** Presentation order on the profile; defaults to 0 in the database. */
  display_order: integerSchema,
  created_at: timestamptzSchema,
  updated_at: timestamptzSchema,
});

export type SocialLinkRow = z.infer<typeof socialLinkRowSchema>;
