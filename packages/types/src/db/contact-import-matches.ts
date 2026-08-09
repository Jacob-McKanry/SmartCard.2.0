/**
 * `public.contact_import_matches` — see
 * 20260809210800_table_contact_import_and_pending_connections.sql
 *
 * Salted hashes of a user's imported contacts and any SmartCard user they
 * matched. Never raw contact details: a breach of this table must not hand an
 * attacker the address book of every user who ever ran an import (§2.7).
 *
 * The property that makes this table safe to have at all is structural, not
 * schematic: there is no code path from here to `connections`. A match is a
 * prompt to go and meet someone, never an edge — which is what keeps mass
 * fake-account farming closed (§4.7 threat 4).
 */
import { z } from "zod";

import { timestamptzSchema, uuidSchema } from "./scalars";

export const contactImportMatchRowSchema = z.object({
  id: uuidSchema,
  owner_user_id: uuidSchema,

  /** The SmartCard user this contact turned out to be, if any. */
  matched_user_id: uuidSchema.nullable(),

  /**
   * Salted hash of a phone number or email. The salt lives in the server
   * environment and never in the database, so this column alone cannot be
   * dictionary-attacked back into a contact list.
   */
  contact_hash: z.string(),

  /**
   * The name as it appeared in the owner's own address book. Sensitive: it is
   * the owner's private annotation about another person, and the person it
   * describes has no right to read it either.
   */
  display_name_snapshot: z.string().nullable(),

  matched_at: timestamptzSchema.nullable(),
  dismissed_at: timestamptzSchema.nullable(),
});

export type ContactImportMatchRow = z.infer<typeof contactImportMatchRowSchema>;
