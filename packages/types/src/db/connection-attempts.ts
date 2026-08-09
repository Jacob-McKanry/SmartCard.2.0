/**
 * `public.connection_attempts` — see
 * 20260809210700_table_connection_attempts_and_app_config.sql
 *
 * The verification audit log, and the dataset the GPS radius is tuned from
 * after the pilot (§4.4). Service role only: it has no RLS policy and no grant
 * to `authenticated`, so this schema is for server-side code, never for
 * anything that renders to a user.
 *
 * None of the numeric fields may reach a client. §4.2 step 7 is explicit that a
 * rejection tells the user only "you need to be near each other" — surfacing
 * the distance or the radius would turn repeated scanning into a range finder
 * for locating a specific person.
 */
import { z } from "zod";

import { doublePrecisionSchema, timestamptzSchema, uuidSchema } from "./scalars";
import { connectionAttemptOutcomeSchema, verificationMethodSchema } from "./enums";

export const connectionAttemptRowSchema = z.object({
  id: uuidSchema,

  /** Nullable: the FKs are ON DELETE SET NULL so audit rows outlive their subjects. */
  session_id: uuidSchema.nullable(),

  method: verificationMethodSchema,

  scanner_user_id: uuidSchema.nullable(),
  presenter_user_id: uuidSchema.nullable(),

  outcome: connectionAttemptOutcomeSchema,

  /**
   * Free text rather than a closed set: the list of reasons grows as the
   * verification service is built, and an over-tight constraint would make the
   * log refuse to record the failures it exists to capture.
   */
  rejection_reason: z.string().nullable(),

  /** Computed server-side. Note this is the distance, not the raw coordinates. */
  distance_m: doublePrecisionSchema.nullable(),
  scanner_accuracy_m: doublePrecisionSchema.nullable(),
  presenter_accuracy_m: doublePrecisionSchema.nullable(),
  radius_config_used_m: doublePrecisionSchema.nullable(),

  /** Hashed, never raw — an IP address is personal data as well as a signal. */
  ip_hash: z.string().nullable(),
  user_agent: z.string().nullable(),

  created_at: timestamptzSchema,
});

export type ConnectionAttemptRow = z.infer<typeof connectionAttemptRowSchema>;
