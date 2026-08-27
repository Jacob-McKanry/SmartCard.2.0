/**
 * `public.event_attendee_imports` — see 20260827130000_table_event_attendee_imports.sql
 *
 * Guest-list rows a verified host uploaded for one event: names, emails, phone
 * numbers and employers belonging to people who have never heard of SmartCard.
 * §2 of `docs/architecture/2026-08-22-event-attendee-import.md`.
 *
 * NOTHING IN THIS APP CAN SELECT THIS TABLE, AND THE ROW SCHEMA BELOW DOES NOT
 * CHANGE THAT. The table has RLS enabled *and* forced with zero policies and
 * zero grants, so it is unreadable even by the table owner's ordinary queries;
 * the only way in is a `security definer` function that checks something first,
 * and today the only such function writes. `eventAttendeeImportRowSchema` is
 * here because this file's siblings promise a mirror of every table in the
 * `public` schema and a reader comparing the two should not have to guess
 * whether a column was forgotten. It describes a shape, not a capability — the
 * same caveat `db/index.ts` states for every schema in this directory, just
 * sharper here, because in this one case the capability is *zero*.
 *
 * THE TWO SCHEMAS THAT ARE ACTUALLY LOAD-BEARING are the payload and summary
 * ones at the bottom: the argument to and the answer from
 * `public.import_event_attendees`.
 */
import { z } from "zod";

import { citextSchema, jsonbSchema, integerSchema, timestamptzSchema, uuidSchema } from "./scalars";

/**
 * One social handle as it appeared in somebody else's export.
 *
 * `url` is deliberately `string` and not a URL: real files contain `@handle`,
 * a bare handle, and a full profile link, and the person whose handle it is has
 * not accepted any of them yet. `normaliseSocialHandle` in
 * `@smartcard/core` drops the values that are plainly not identifiers ("N/A",
 * a whole sentence) before they get this far; what survives is stored as typed
 * and shown back to that person on their claim screen for them to correct.
 */
export const attendeeImportSocialLinkSchema = z.object({
  platform: z.string().min(1).max(40),
  url: z.string().min(1).max(500),
});

export type AttendeeImportSocialLink = z.infer<typeof attendeeImportSocialLinkSchema>;

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export const eventAttendeeImportRowSchema = z.object({
  id: uuidSchema,
  event_id: uuidSchema,

  /**
   * `extensions.citext`, for the same reason `users.email` is: matching has to
   * be case-insensitive or Sarah@x.com and sarah@x.com become two people and
   * one of them can never claim. `citextSchema` is a plain string on this side
   * — TypeScript cannot express case-insensitive equality, so any comparison
   * done in JS against this value must lowercase both sides itself.
   */
  email: citextSchema,

  /**
   * All nullable. A guest list may carry nothing but an email and that is a
   * valid import: the prefill is a convenience, not the point.
   */
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  phone_number: z.string().nullable(),
  company_name: z.string().nullable(),
  company_role: z.string().nullable(),

  /** `[{"platform": "...", "url": "..."}]` — see the social-link schema above. */
  social_links: jsonbSchema,

  /**
   * What the emailed claim link carries. NOT a credential: claiming
   * additionally requires a verified email matching the row, because mail gets
   * forwarded and a link that auto-claims lets anyone who ever sees the message
   * take somebody else's data.
   */
  lookup_token: z.string(),

  /** `ON DELETE SET NULL` — attribution of who imported, not a fact about them. */
  imported_by_user_id: uuidSchema.nullable(),
  imported_at: timestamptzSchema,

  /**
   * When the importing host asserted they may contact these people about this
   * event. NOT NULL in the database so no code path can write a row without it.
   */
  attested_at: timestamptzSchema,

  source: z.string(),

  claimed_by_user_id: uuidSchema.nullable(),
  claimed_at: timestamptzSchema.nullable(),

  /**
   * Set from `app_config` at insert time, not defaulted in the DDL, so changing
   * the retention setting affects new imports without a migration. Unclaimed
   * rows are contact details for people who never signed up; holding them
   * forever is the thing that turns this feature into a liability.
   */
  expires_at: timestamptzSchema,
});

export type EventAttendeeImportRow = z.infer<typeof eventAttendeeImportRowSchema>;

// ---------------------------------------------------------------------------
// The RPC argument
// ---------------------------------------------------------------------------

/**
 * One element of `p_rows` for `public.import_event_attendees`.
 *
 * WHY THIS IS VALIDATED AT ALL, GIVEN THE RPC IS THE SECURITY BOUNDARY
 *
 * It is not here to protect the database — it cannot. Every gate that decides
 * whether an import may happen (active verified host, host of this specific
 * non-cancelled event, an attestation, the row cap, the daily budget) is
 * re-derived inside the function from values it reads itself, and a host who
 * skips the whole web app and calls the RPC directly hits every one of them.
 *
 * It is here so a *shape* bug is caught where it can still be explained. The
 * function reads each row with `v_row ->> 'first_name'`, which answers `null`
 * for a key that is missing, misspelled, or holds a nested object — so a
 * mis-built payload does not fail, it silently imports a guest list with every
 * name blank, and the host finds out when the emails go out. Refusing an
 * unexpected shape up front turns that into an error on the review screen.
 *
 * `.strict()` for the same reason: an extra key is not harmless here, it is the
 * signal that the client is sending a field this contract does not carry —
 * most plausibly a column from the uploaded CSV that the mapping screen was
 * supposed to drop. The RPC would ignore it, but ignoring PII somebody did not
 * mean to send is not the behaviour to want from an import path.
 */
export const attendeeImportPayloadRowSchema = z
  .object({
    /**
     * Not `z.email()`. The database's own rule is `position('@' in email) > 0`
     * after trimming, and `normaliseImportRows` applies the same one, so a
     * stricter check here would reject rows the import path is designed to
     * accept and would move the definition of "usable address" into a third
     * place. Bounded because it becomes a database value.
     */
    email: z.string().min(3).max(320),

    first_name: z.string().max(200).nullable(),
    last_name: z.string().max(200).nullable(),
    phone_number: z.string().max(50).nullable(),
    company_name: z.string().max(200).nullable(),
    company_role: z.string().max(200).nullable(),
    social_links: z.array(attendeeImportSocialLinkSchema).max(10),
  })
  .strict();

export type AttendeeImportPayloadRow = z.infer<typeof attendeeImportPayloadRowSchema>;

/**
 * The whole `p_rows` array.
 *
 * Deliberately NOT capped at `event_import_max_rows`. That number lives in
 * `app_config` (5000 by default) precisely so it can be changed on the night of
 * a pilot event without a deploy, and `app_config` is unreadable to
 * `authenticated` — so a cap written here would be a stale copy of a value this
 * side cannot see, and would start refusing imports the database would accept
 * the moment somebody raised it. The RPC counts the array before writing
 * anything, so an oversized upload writes nothing rather than the first N.
 */
export const attendeeImportPayloadSchema = z.array(attendeeImportPayloadRowSchema);

// ---------------------------------------------------------------------------
// The RPC answer
// ---------------------------------------------------------------------------

/**
 * What `public.import_event_attendees` returns: counts, never rows.
 *
 * `skipped_already_claimed` is a count and has to stay one. A per-person list
 * of who has already claimed would tell the host which of their guests hold
 * SmartCard accounts, which is a fact about those people and not about the
 * host's own file.
 */
export const attendeeImportSummarySchema = z.object({
  /** Rows written for the first time. */
  imported: integerSchema.min(0),
  /** Rows that already existed for this (event, email) and were corrected. */
  updated: integerSchema.min(0),
  /** Rows with no `@` in the email — no identity, and no way to ever claim. */
  skipped_no_email: integerSchema.min(0),
  /** Rows belonging to somebody who has already claimed; left untouched. */
  skipped_already_claimed: integerSchema.min(0),
});

export type AttendeeImportSummary = z.infer<typeof attendeeImportSummarySchema>;
