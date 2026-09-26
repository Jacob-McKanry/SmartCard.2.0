/**
 * Request/response shapes for the unverified "add a contact" flow — manual
 * entry, OCR card scan, badge QR/barcode, badge NFC tap. All four converge on
 * `create_manual_connection` (20260926130000).
 *
 * See docs/architecture/2026-09-26-unverified-connections.md for the product
 * decision this implements, and `qrRedeemRequestSchema`/`nfcRedeemRequestSchema`
 * above for the verified counterparts this deliberately does NOT extend — this
 * is a separate, second entry point by design, not a widened version of those.
 *
 * WHAT IS DELIBERATELY ABSENT FROM THE REQUEST SHAPE, MATCHING THE FILE HEADER
 * ABOVE. No `creatorUserId` — the caller's identity comes from
 * `getAuthenticatedContext()` server-side, never from the request body, the
 * same as every verified endpoint. There IS a slot for the other party's
 * identity or contact details, because unlike the verified flows, naming the
 * other party (or describing them) is the entire point of this one — that is
 * the product decision, not an oversight.
 */
import { z } from "zod";

import { citextSchema, latitudeSchema, longitudeSchema, uuidSchema } from "../db/scalars";
import { manualConnectionMethodSchema } from "../db/enums";

/**
 * Free-typed or scanned contact details for someone with no SmartCard account
 * yet — the field set `create_manual_connection` seeds a placeholder `users`
 * row from. Every field optional: a business card might have only a phone, a
 * manual entry might have only a name. `create_manual_connection` itself
 * refuses if NEITHER an email nor a phone can be resolved to a party at all
 * only implicitly, by there being nothing to match or placeholder on — this
 * schema does not additionally require one, matching the RPC's own posture
 * of accepting what it's given.
 */
export const manualContactSchema = z
  .object({
    email: citextSchema.optional(),
    phone_number: z.string().min(1).max(32).optional(),
    first_name: z.string().min(1).max(200).optional(),
    last_name: z.string().min(1).max(200).optional(),
    company_name: z.string().min(1).max(200).optional(),
    company_role: z.string().min(1).max(200).optional(),
  })
  .strict();

export type ManualContact = z.infer<typeof manualContactSchema>;

/**
 * A device-captured GPS fix at the moment of adding — logged the same way a
 * verified meeting's location is, but NEVER a gate (see the architecture
 * doc's "location logging, not a hard requirement" decision). Omit entirely
 * for "no location captured or the user cleared it" — matching the existing
 * "absence of a `meeting_locations` row" convention.
 */
export const manualConnectionLocationSchema = z
  .object({
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    accuracyM: z.number().nonnegative(),
  })
  .strict();

export type ManualConnectionLocation = z.infer<typeof manualConnectionLocationSchema>;

/**
 * POST body for the "add a contact" server action, whichever of the four
 * input modes produced it (manual form, OCR, QR/barcode decode, NFC badge
 * tap all fill this same shape client-side before submitting).
 *
 * Exactly one of `otherUserId` / `otherContact` — enforced by `.refine()`
 * below, mirroring `create_manual_connection`'s own "exactly one" check
 * server-side (defence in depth, not a substitute for it).
 */
export const createManualConnectionRequestSchema = z
  .object({
    method: manualConnectionMethodSchema,
    /** Set when the client already resolved a real account (e.g. picked from a match). */
    otherUserId: uuidSchema.optional(),
    /** Set when no existing account was resolved client-side — the RPC does its own match. */
    otherContact: manualContactSchema.optional(),
    occurredAt: z.iso.datetime({ offset: true }).optional(),
    location: manualConnectionLocationSchema.optional(),
  })
  .strict()
  .refine((v) => (v.otherUserId === undefined) !== (v.otherContact === undefined), {
    message: "Provide exactly one of otherUserId or otherContact.",
  });

export type CreateManualConnectionRequest = z.infer<typeof createManualConnectionRequestSchema>;

/**
 * `{ok:true, ...}` names enough for the client to route to the new
 * connection or profile; `{ok:false, message}` carries only a message, not a
 * reason code — matching `connectRedeemResponseSchema`'s posture even though
 * this flow's refusal reasons (self-connect, blocked, already-connected,
 * unavailable) are far less sensitive than a proximity-gate rejection. There
 * is still no reason to hand a client a machine-readable code for something
 * a plain sentence already answers.
 */
export const createManualConnectionResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      connectionId: uuidSchema,
      meetingId: uuidSchema,
      otherUserId: uuidSchema,
      /** True when this reactivated a connection the pair had previously removed. */
      reconnected: z.boolean(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      message: z.string(),
    })
    .strict(),
]);

export type CreateManualConnectionResponse = z.infer<typeof createManualConnectionResponseSchema>;
