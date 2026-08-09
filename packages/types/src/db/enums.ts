/**
 * The value sets enforced by CHECK constraints in the migrations.
 *
 * These are `text` columns with a CHECK rather than Postgres enum types
 * (architecture proposal §2.1): a CHECK makes adding a value a one-line
 * migration instead of a type rewrite, while still being impossible for
 * application code to bypass. Mirroring them as Zod enums here means the
 * TypeScript side gets the same closed set, and a typo is a compile error
 * rather than a runtime constraint violation.
 *
 * Any change here must be made together with the corresponding CHECK
 * constraint. If the two drift, TypeScript will happily let you write a value
 * the database then refuses.
 */
import { z } from "zod";

/** `users.status` */
export const userStatusSchema = z.enum(["active", "suspended", "deleted"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

/**
 * `cards.status`.
 *
 * `revoked` is the owner-operated kill switch for a lost or stolen card
 * (§4.5), and is the only transition a client is permitted to make.
 */
export const cardStatusSchema = z.enum(["unassigned", "assigned", "revoked"]);
export type CardStatus = z.infer<typeof cardStatusSchema>;

/**
 * `connections.status`.
 *
 * The `removed` -> `active` transition is refused by RLS: restoring a
 * connection would produce a live edge with no fresh verification behind it,
 * which is the same outcome as inserting one. Reconnecting means meeting again.
 */
export const connectionStatusSchema = z.enum(["active", "removed"]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

/**
 * `meetings.verification_method`, `connection_sessions.method`,
 * `connection_attempts.method`.
 *
 * The two ways proximity can be proven: a GPS-gated QR scan, or a physical card
 * tap where NFC's few-centimetre range is itself the proof (§4.5).
 */
export const verificationMethodSchema = z.enum(["qr_gps", "nfc_card"]);
export type VerificationMethod = z.infer<typeof verificationMethodSchema>;

/** `meetings.location_visibility` */
export const locationVisibilitySchema = z.enum(["participants_only", "mutuals"]);
export type LocationVisibility = z.infer<typeof locationVisibilitySchema>;

/** `connection_sessions.status` */
export const connectionSessionStatusSchema = z.enum(["active", "consumed", "expired", "revoked"]);
export type ConnectionSessionStatus = z.infer<typeof connectionSessionStatusSchema>;

/** `connection_attempts.outcome` */
export const connectionAttemptOutcomeSchema = z.enum(["success", "rejected"]);
export type ConnectionAttemptOutcome = z.infer<typeof connectionAttemptOutcomeSchema>;

/**
 * `events.visibility`.
 *
 * `public` is what makes an event row readable by any authenticated user — the
 * one deliberate exception to graph-gating in this schema (§2.6). The column
 * defaults to `private`.
 */
export const eventVisibilitySchema = z.enum(["public", "private"]);
export type EventVisibility = z.infer<typeof eventVisibilitySchema>;

/**
 * `event_rsvps.status`.
 *
 * Only `going` counts as attendance for `private.shares_event_with()`, which is
 * a branch of the `users` read policy — so this distinction has access-control
 * consequences, not just display ones.
 */
export const rsvpStatusSchema = z.enum(["going", "interested", "not_going", "waitlist"]);
export type RsvpStatus = z.infer<typeof rsvpStatusSchema>;

/** `pending_connections.status` — deferred flow, §2.8. */
export const pendingConnectionStatusSchema = z.enum(["pending", "claimed", "expired", "cancelled"]);
export type PendingConnectionStatus = z.infer<typeof pendingConnectionStatusSchema>;
