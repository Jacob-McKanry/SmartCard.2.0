/**
 * `public.pending_connections` — see
 * 20260809210800_table_contact_import_and_pending_connections.sql
 *
 * A schema slot for the deferred non-user flow ("I met someone who isn't on
 * SmartCard yet", §2.8). Built now, unreachable now: the table has no RLS
 * policy and no grant to `authenticated`, so nothing but service-role code can
 * touch it until the flow is built.
 *
 * It hangs off `connection_sessions` — the same table QR and NFC already use —
 * so a pending connection carries the same verification evidence a real one
 * does, and the flow can be built later without touching graph tables.
 *
 * Every contact field here describes a person who has not signed up and
 * therefore has not agreed to anything. Treat the whole row as sensitive.
 */
import { z } from "zod";

import { latitudeSchema, longitudeSchema, timestamptzSchema, uuidSchema } from "./scalars";
import { pendingConnectionStatusSchema } from "./enums";

export const pendingConnectionRowSchema = z.object({
  id: uuidSchema,
  initiator_user_id: uuidSchema,
  session_id: uuidSchema,

  contact_name: z.string().nullable(),
  contact_email: z.string().nullable(),
  contact_phone: z.string().nullable(),

  place_label: z.string().nullable(),
  latitude: latitudeSchema.nullable(),
  longitude: longitudeSchema.nullable(),

  occurred_at: timestamptzSchema.nullable(),

  /** Never equal to `initiator_user_id` — enforced by a CHECK constraint. */
  claimed_by_user_id: uuidSchema.nullable(),
  claimed_at: timestamptzSchema.nullable(),

  status: pendingConnectionStatusSchema,
});

export type PendingConnectionRow = z.infer<typeof pendingConnectionRowSchema>;
