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
 * host's own file. `matched_existing_accounts` (20260903140000) is the same
 * shape of disclosure for the same reason — it says how many, never who.
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
  /**
   * Rows matching an existing, active SmartCard account — auto-claimed
   * immediately with no click, per 20260903140000's owner decision. A subset
   * of `imported`/`updated`, not additional to them.
   */
  matched_existing_accounts: integerSchema.min(0),
});

export type AttendeeImportSummary = z.infer<typeof attendeeImportSummarySchema>;

// ---------------------------------------------------------------------------
// C4 — the claim flow: `get_claimable_import` and `claim_event_import`
// ---------------------------------------------------------------------------

/**
 * The personal prefill from `get_claimable_import`, present only when the
 * caller passed §3.2/§3.2.1's gate (`can_claim: true`). Every field is
 * individually keepable on the review screen (§4.2 step 4), which is what
 * `claimApprovedFieldsSchema` below records.
 */
export const attendeeImportClaimPrefillSchema = z.object({
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  phone_number: z.string().nullable(),
  company_name: z.string().nullable(),
  company_role: z.string().nullable(),
  social_links: z.array(attendeeImportSocialLinkSchema),
});

export type AttendeeImportClaimPrefill = z.infer<typeof attendeeImportClaimPrefillSchema>;

/**
 * What `public.get_claimable_import` returns. A discriminated union on
 * `available` rather than one object with optional fields, so a caller who
 * forgets to check `available` first cannot accidentally read `undefined`
 * out of a shape that looks populated.
 *
 * `available: false` is the ONE shape for every refusal §3.6 groups together
 * — no such token, expired, already claimed, rate-limited on either budget,
 * or a missing `app_config` row surfacing as a thrown error the caller
 * catches. This schema cannot express which one happened, on purpose: if a
 * caller finds itself wanting to, that is the design this type exists to
 * prevent.
 *
 * `available: true` still does not imply the prefill is visible —
 * `can_claim` gates that separately (§11.1.4's "two disclosure levels").
 */
export const claimableImportSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(false) }),
  z.object({
    available: z.literal(true),
    event_id: uuidSchema,
    event_name: z.string(),
    host_first_name: z.string().nullable(),
    host_last_name: z.string().nullable(),
    can_claim: z.boolean(),
    prefill: attendeeImportClaimPrefillSchema.nullable(),
  }),
]);

export type ClaimableImport = z.infer<typeof claimableImportSchema>;

/**
 * `p_approved_fields` for `public.claim_event_import` — which prefilled
 * fields the caller chose to keep. Every key optional and every value
 * defaults to discard (`claim_event_import` itself reads a missing or
 * malformed key as `false`, per that migration's own comment) — the
 * fail-closed direction: get this wrong and the failure is a field the
 * person did NOT ask for silently not being copied, never the reverse.
 *
 * Deliberately not `.strict()`, unlike the import payload row schema: this
 * object is built by this app's own review screen, not accepted from a CSV a
 * host uploaded, so there is no adjacent-column-leak risk to guard against
 * here.
 */
export const claimApprovedFieldsSchema = z.object({
  first_name: z.boolean().optional(),
  last_name: z.boolean().optional(),
  phone_number: z.boolean().optional(),
  company_name: z.boolean().optional(),
  company_role: z.boolean().optional(),
  social_links: z.boolean().optional(),
});

export type ClaimApprovedFields = z.infer<typeof claimApprovedFieldsSchema>;

/**
 * What `public.claim_event_import` returns: a boolean and nothing else,
 * matching `CardClaimResult` for the identical §3.6 reason — wrong token,
 * already claimed, expired, wrong email, rate-limited and a lost race all
 * collapse to `{claimed: false}`.
 */
export const claimEventImportResultSchema = z.object({
  claimed: z.boolean(),
});

export type ClaimEventImportResult = z.infer<typeof claimEventImportResultSchema>;

// ---------------------------------------------------------------------------
// C5 — "you attended": `own_attended_events`
// ---------------------------------------------------------------------------

/**
 * One row of `public.own_attended_events()` — the two fields §2.2's
 * destroy-on-claim `UPDATE` leaves behind on a claimed row. Nothing else
 * about the import survives to be read back.
 */
export const ownAttendedEventSchema = z.object({
  event_id: uuidSchema,
  claimed_at: timestamptzSchema,
});

export type OwnAttendedEvent = z.infer<typeof ownAttendedEventSchema>;

export const ownAttendedEventsSchema = z.array(ownAttendedEventSchema);

// ---------------------------------------------------------------------------
// The interim hand-delivery surface: `list_own_import_links`
// ---------------------------------------------------------------------------

/**
 * One pending claim link from `public.list_own_import_links` —
 * 20260829120000, and §11.5 of the import design doc.
 *
 * THIS FILE'S HEADER SAYS "NOTHING IN THIS APP CAN SELECT THIS TABLE". That is
 * still true of the table, and now has one narrow exception at the RPC layer,
 * recorded as a deviation rather than a change of mind: §5's email phase does
 * not exist, so without this the `lookup_token` a claim link is built from has
 * no way out of the database and the whole claim flow cannot be exercised by a
 * real person. It is a stopgap until mail is sent for the host.
 *
 * FOUR FIELDS, AND NO MORE, and each absence is deliberate:
 *   - `phone_number`, `company_name`, `company_role`, `social_links` are in the
 *     host's own CSV already and nothing about sending somebody a link needs
 *     them, so returning them would be a second copy of contact details behind
 *     a second set of checks.
 *   - Nothing identifies who has CLAIMED. The RPC returns only unclaimed rows
 *     precisely so this list cannot answer "which of my guests hold SmartCard
 *     accounts" — a fact about those people, not about the host's file (§3.9).
 *
 * `email` IS here, and is the one field worth justifying rather than assuming:
 * the host has to know where to send the link, and a guest list may carry
 * nothing but an address, so a name is not a usable identifier on every row.
 */
export const importClaimLinkSchema = z.object({
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: citextSchema,
  /** The 244-bit token a `/claim/[token]` URL carries. */
  lookup_token: z.string(),
});

export type ImportClaimLink = z.infer<typeof importClaimLinkSchema>;

/**
 * A page of pending links, plus the aggregate §3.9 already permits.
 *
 * `unclaimed_total` counts every unclaimed unexpired row this caller imported
 * into this event, not just the page — so the screen can page honestly. It is
 * a count and stays one for the same reason `skipped_already_claimed` does.
 */
export const importClaimLinkPageSchema = z.object({
  unclaimed_total: integerSchema.min(0),
  links: z.array(importClaimLinkSchema),
});

export type ImportClaimLinkPage = z.infer<typeof importClaimLinkPageSchema>;
