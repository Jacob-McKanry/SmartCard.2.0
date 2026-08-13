/**
 * `public.user_push_tokens` — see 20260813210100_table_user_push_tokens.sql
 *
 * One row per registered device per user, holding the Expo push token §7.5
 * delivers to. It exists as a security control rather than a feature: Q17
 * removed the confirmation step from the card-tap path, so the compensating
 * control is telling the owner the instant a tap commits (§4.7 threat 7).
 *
 * Self-only read and write, with no graph branch of any kind. The danger with
 * this table is not what a row reveals but what it enables — a push token is a
 * capability to write arbitrary text on a specific person's lock screen.
 */
import { z } from "zod";

import { timestamptzSchema, uuidSchema } from "./scalars";

export const pushPlatformSchema = z.enum(["ios", "android", "web"]);
export type PushPlatform = z.infer<typeof pushPlatformSchema>;

export const userPushTokenRowSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,

  /** Sensitive. Never travels to another user by any path; sending is service-role only. */
  expo_push_token: z.string(),

  platform: pushPlatformSchema,

  /** NOT NULL in the table: a null would opt the row out of the per-device unique constraint. */
  device_id: z.string(),

  last_seen_at: timestamptzSchema,

  /**
   * Set when Expo reports `DeviceNotRegistered`. Excluded from the
   * `authenticated` grants, so a client never reads or writes it — which is why
   * it is nullable here but absent from `userPushTokenRegistrationSchema`.
   */
  disabled_at: timestamptzSchema.nullable(),

  created_at: timestamptzSchema,
});

export type UserPushTokenRow = z.infer<typeof userPushTokenRowSchema>;

/**
 * What a client may send when registering a device, mirroring the column-level
 * INSERT grant. `user_id` is absent on purpose: the server sets it from the
 * authenticated session, and the INSERT policy pins it to the caller anyway —
 * a client that could name the user_id could register a token against somebody
 * else's account and receive their notifications.
 */
export const userPushTokenRegistrationSchema = z
  .object({
    expo_push_token: z.string().min(1).max(512),
    platform: pushPlatformSchema,
    device_id: z.string().min(1).max(128),
  })
  .strict();

export type UserPushTokenRegistration = z.infer<typeof userPushTokenRegistrationSchema>;
