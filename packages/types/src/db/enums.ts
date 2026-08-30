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

/**
 * The same union under a name that does not collide with §4.1's
 * `VerificationMethod` *interface* in `packages/core`. That interface is the
 * pluggable verifier ("a future verification method means one new
 * implementation"); this type is the two-value column. They are different
 * things with the same obvious name, and importing both into one file is
 * routine — so the alias exists to stop that being resolved by whichever
 * import happened to come last.
 */
export type VerificationMethodId = VerificationMethod;

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
 * `connection_attempts.radius_mode` (added 20260813210000, §2.5 amendment (b)).
 *
 * Orthogonal to `outcome`, not an extension of it: a relaxed attempt can
 * succeed or be rejected, and both are interesting. Two values and no third —
 * §4.3's relaxation is a rung, not a ladder, and a `radius_mode` with three
 * values would be the first sign someone had turned it into one.
 */
export const radiusModeSchema = z.enum(["normal", "relaxed"]);
export type RadiusMode = z.infer<typeof radiusModeSchema>;

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
 * `events.status` — `scheduled` | `cancelled` (20260815130100) |
 * `draft` (20260830150000).
 *
 * `scheduled` and `draft` are the only two values a client may write, and
 * only at INSERT — the host's own choice of whether the event is live yet,
 * the same kind of decision `visibility` already is via an ordinary column
 * grant. `status` is deliberately absent from the column-level UPDATE grant
 * on `events`, so neither value is ever set by an ordinary PATCH: the only
 * writers after creation are `public.publish_event()` (draft -> scheduled,
 * host-only) and `public.soft_delete_own_account()` (-> cancelled, cancelling
 * the events of a host who has deleted their account). A cancelled event is
 * never deleted — it stays readable to its host and to everyone holding an
 * RSVP or an invite, and leaves only the "any authenticated user may see a
 * public event" branch of `private.can_see_event`, exactly as a draft does —
 * so an event somebody was counting on does not silently vanish from under
 * them, and a draft stays invisible to everyone but its host until published.
 */
export const eventStatusSchema = z.enum(["scheduled", "cancelled", "draft"]);
export type EventStatus = z.infer<typeof eventStatusSchema>;

/**
 * `events.cancelled_reason` — why a cancelled event was cancelled.
 *
 * One value today because there is one writer today: this product has no
 * host-facing "cancel my event" control. The column exists because it is what
 * makes a soft delete reversible with precision — `public.restore_deleted_user`
 * un-cancels only the events THAT deletion cancelled, so restoring an account
 * cannot resurrect an event its host had deliberately called off. A host-facing
 * cancel control adds its own value here and to the CHECK in 20260815130100.
 */
export const eventCancelReasonSchema = z.enum(["host_account_deleted"]);
export type EventCancelReason = z.infer<typeof eventCancelReasonSchema>;

/**
 * `event_rsvps.status` — the six values the column may hold, widened from four
 * by 20260814051000.
 *
 * Only `going` counts as attendance for `private.shares_event_with()`, which is
 * a branch of the `users` read policy — so this distinction has access-control
 * consequences, not just display ones.
 *
 * Read this together with `rsvpIntentSchema` below: three of these six are
 * things a person says about themselves, and three are outcomes the server
 * computes. A client can never write any of them directly — every status
 * transition goes through `public.request_event_rsvp` or
 * `public.decide_event_rsvp` (20260814051200), because `going` means different
 * real things depending on the event's capacity and approval settings.
 */
export const rsvpStatusSchema = z.enum([
  "going",
  "interested",
  "not_going",
  "waitlist",
  "pending",
  "denied",
]);
export type RsvpStatus = z.infer<typeof rsvpStatusSchema>;

/**
 * What a person may *ask* for — the `p_status` argument of
 * `public.request_event_rsvp`.
 *
 * Deliberately a strict subset of `rsvpStatusSchema`. `pending`, `waitlist` and
 * `denied` are outcomes, not intents: `pending` and `waitlist` are what the
 * server stores when the event requires approval or is full, and `denied` is
 * somebody else's decision about you. The RPC rejects all three with
 * `invalid_intent` rather than translating them, and this schema is the same
 * refusal one layer earlier so a bad value is a TypeScript error instead of a
 * round trip.
 */
export const rsvpIntentSchema = z.enum(["going", "interested", "not_going"]);
export type RsvpIntent = z.infer<typeof rsvpIntentSchema>;

/**
 * The `p_decision` argument of `public.decide_event_rsvp` — what a host may do
 * about somebody else's request.
 *
 * Two values, not four: a host approves or denies. There is no "eject" (deny on
 * an already-`going` row) and no "reinstate" (approve on a `denied` row); the
 * migration header records why each of those is refused rather than built.
 */
export const rsvpDecisionSchema = z.enum(["approve", "deny"]);
export type RsvpDecision = z.infer<typeof rsvpDecisionSchema>;

/** `pending_connections.status` — deferred flow, §2.8. */
export const pendingConnectionStatusSchema = z.enum(["pending", "claimed", "expired", "cancelled"]);
export type PendingConnectionStatus = z.infer<typeof pendingConnectionStatusSchema>;
