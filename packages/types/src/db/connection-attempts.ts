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
import {
  connectionAttemptOutcomeSchema,
  radiusModeSchema,
  verificationMethodSchema,
} from "./enums";

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

  // --- Added 20260813210000, per §2.5 amendment (b) ------------------------

  /**
   * Whether this attempt was evaluated against the relaxed thresholds (§4.3
   * amendment). Explicit rather than inferred from `radius_config_used_m`,
   * because that number stops distinguishing the two the moment someone tunes
   * the normal radius up — exactly the tuning §4.4 anticipates. Audit data has
   * to survive its own configuration history.
   *
   * It is a separate column rather than a third `outcome` value on purpose:
   * §3.6 constrained `outcome` to success|rejected for cross-row
   * comparability, and a `relaxed_success` outcome would silently under-count
   * successes in every query written before it existed. `radius_mode` composes
   * with `outcome` instead — relaxed *rejections* are as interesting as relaxed
   * successes (§4.4 amendment, question 4).
   */
  radius_mode: radiusModeSchema,

  /** The accuracy floor in force, for symmetry with `radius_config_used_m`. Never returned to a user. */
  accuracy_config_used_m: doublePrecisionSchema.nullable(),

  /**
   * On a relaxed attempt, the earlier distance/accuracy rejection by this same
   * pair that unlocked it — so §4.4 question 3 ("did relaxation actually rescue
   * people?") is answered by joining rather than by guessing at the pairing.
   */
  relaxation_source_attempt_id: uuidSchema.nullable(),
});

export type ConnectionAttemptRow = z.infer<typeof connectionAttemptRowSchema>;
