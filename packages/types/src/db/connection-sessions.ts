/**
 * `public.connection_sessions` — see 20260809210400_table_connection_sessions.sql
 *
 * One live "I am presenting, come and connect to me" session. Every connection
 * in SmartCard traces back to a row here, and single-use is enforced at the
 * session level rather than the token level (§4.2 step 6) — consuming the
 * session kills every token ever minted from it, including a screenshotted one.
 *
 * Only the presenter can read their own session, and nothing can write one
 * through RLS: sessions are created, rotated and consumed by the verification
 * service alone.
 */
import { z } from "zod";

import {
  accuracyMetresSchema,
  latitudeSchema,
  longitudeSchema,
  timestamptzSchema,
  uuidSchema,
} from "./scalars";
import { connectionSessionStatusSchema, verificationMethodSchema } from "./enums";

export const connectionSessionRowSchema = z.object({
  /** The `sid` carried inside the QR payload (§4.2 step 2). */
  id: uuidSchema,

  method: verificationMethodSchema,
  presenter_user_id: uuidSchema,
  status: connectionSessionStatusSchema,

  /**
   * The nonce in the currently displayed QR, and the one it replaced.
   * `previous_nonce` is the rotation grace window: a scan already in flight
   * when the code rotated is a legitimate scan. Both are null for `nfc_card`
   * sessions, which have no nonce.
   */
  current_nonce: z.string().nullable(),
  nonce_issued_at: timestamptzSchema.nullable(),
  previous_nonce: z.string().nullable(),

  /**
   * The presenter's last reported position, refreshed by the ~20s heartbeat
   * while the code is displayed. Null before the first heartbeat lands and for
   * card taps. Missing or stale values must cause the verification service to
   * reject (§4.3) — nullability here describes the column, not the rule.
   */
  presenter_latitude: latitudeSchema.nullable(),
  presenter_longitude: longitudeSchema.nullable(),
  presenter_accuracy_m: accuracyMetresSchema.nullable(),
  presenter_location_at: timestamptzSchema.nullable(),

  /** Binds the session to the device that created it (§4.7 threat 3). */
  device_id: z.string().nullable(),

  expires_at: timestamptzSchema,
  consumed_at: timestamptzSchema.nullable(),

  /**
   * Never equal to `presenter_user_id` — a CHECK constraint enforces that you
   * cannot connect to yourself through any route (§4.2 validation step 6).
   */
  consumed_by_user_id: uuidSchema.nullable(),
});

export type ConnectionSessionRow = z.infer<typeof connectionSessionRowSchema>;
