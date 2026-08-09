/**
 * `public.app_config` — see
 * 20260809210700_table_connection_attempts_and_app_config.sql
 *
 * The tunable thresholds the connection-verification gate reads. Every one of
 * them is a row rather than a constant because GPS is unreliable indoors and
 * the radius has to be adjustable while an event is happening — a constant in
 * TypeScript needs a deploy, and one in the mobile bundle needs an app store
 * review (§4.3).
 *
 * Service role only: no policy, no grant to `authenticated`. These values must
 * not reach a client, because they say exactly how far away an attacker may
 * stand and how long a token stays valid.
 */
import { z } from "zod";

import { jsonbSchema, timestamptzSchema, uuidSchema } from "./scalars";

/**
 * The six keys seeded by the migration. Typed as a closed set so a typo in a
 * lookup is a compile error rather than a silent `undefined` that the caller
 * then treats as "no limit".
 */
export const appConfigKeySchema = z.enum([
  "qr_max_distance_m",
  "qr_max_accuracy_m",
  "qr_token_ttl_seconds",
  "qr_rotation_seconds",
  "presenter_location_max_age_seconds",
  "session_max_lifetime_seconds",
]);
export type AppConfigKey = z.infer<typeof appConfigKeySchema>;

export const appConfigRowSchema = z.object({
  /**
   * Deliberately `string`, not `appConfigKeySchema`: the column is plain text
   * and a future migration may add a key, so a row read back must still parse.
   * Use `appConfigKeySchema` when *looking a value up*, where the closed set is
   * what you want.
   */
  key: z.string(),

  /** `jsonb`. Every key seeded so far holds a number — see `appConfigNumberSchema`. */
  value: jsonbSchema,

  description: z.string().nullable(),
  updated_at: timestamptzSchema,

  /** Which admin last changed a threshold; survives their deletion (SET NULL). */
  updated_by: uuidSchema.nullable(),
});

export type AppConfigRow = z.infer<typeof appConfigRowSchema>;

/**
 * Parser for the value of a threshold key.
 *
 * All six seeded thresholds are non-negative numbers of metres or seconds.
 * Parsing through this rather than casting means a malformed config row — a
 * string, a null, a negative — throws at the point of use, so the gate refuses
 * to run rather than silently comparing against `NaN`, which would compare
 * false and let everything through.
 */
export const appConfigNumberSchema = z.number().min(0);
