/**
 * `public.users` — see supabase/migrations/20260809210100_table_users_and_social_links.sql
 *
 * One row per human. Which rows a caller can read is decided by the RLS policy
 * in 20260809211100 (self, verified connections, event co-attendees) — this
 * schema describes the shape of a row, never the right to see one.
 */
import { z } from "zod";

import { bigintSchema, citextSchema, timestamptzSchema, uuidSchema } from "./scalars";
import { userStatusSchema } from "./enums";

export const userRowSchema = z.object({
  id: uuidSchema,

  /** Kinde `sub` — the sole link between an authenticated session and this row (§5.3). */
  kinde_user_id: z.string(),

  email: citextSchema,

  first_name: z.string().nullable(),
  last_name: z.string().nullable(),

  /** Nullable; Q3 (do we still need usernames without a global search?) is open. */
  username: citextSchema.nullable(),

  /** Sensitive. Only reachable through the graph-gated select policy. */
  phone_number: z.string().nullable(),

  bio: z.string().nullable(),
  company_name: z.string().nullable(),
  company_role: z.string().nullable(),

  /**
   * Object path inside the private `profile-photos` bucket, not a URL (§6.5).
   * Rendering it requires a short-lived signed URL, which is what keeps a photo
   * as gated as the profile it belongs to.
   */
  photo_path: z.string().nullable(),

  status: userStatusSchema,

  is_admin: z.boolean(),
  email_verified: z.boolean(),
  has_completed_signup: z.boolean(),
  email_opt_in: z.boolean(),

  /** Migration traceability only (§6.2). */
  legacy_user_id: bigintSchema.nullable(),

  created_at: timestamptzSchema,
  updated_at: timestamptzSchema,
});

export type UserRow = z.infer<typeof userRowSchema>;

/**
 * The exact set of fields a user may change about themselves.
 *
 * This is not a convenience type — it mirrors the column-level UPDATE grant in
 * 20260809211100 one-for-one. RLS decides which *row* you may update; the
 * column grant decides which *columns*, and that is where the privilege
 * boundary actually sits: `is_admin`, `status`, `email`, `email_verified`,
 * `kinde_user_id` and `has_completed_signup` are excluded so a client cannot
 * promote itself, un-suspend itself, or rebind its row to a different Kinde
 * identity even if it talks to PostgREST directly.
 *
 * Keep this in sync with that grant. If a field is added here but not to the
 * grant, the write fails at the database with a permission error; if it is
 * added to the grant but not here, the boundary silently widens without anyone
 * reading a TypeScript diff noticing.
 */
export const userProfileUpdateSchema = userRowSchema
  .pick({
    first_name: true,
    last_name: true,
    username: true,
    phone_number: true,
    bio: true,
    company_name: true,
    company_role: true,
    photo_path: true,
    email_opt_in: true,
  })
  .partial();

export type UserProfileUpdate = z.infer<typeof userProfileUpdateSchema>;
