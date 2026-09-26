"use server";

import { revalidatePath } from "next/cache";
import {
  manualConnectionMethodSchema,
  manualContactSchema,
  manualConnectionLocationSchema,
} from "@smartcard/types";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { safeActionErrorMessage, UserFacingError } from "@/server/errors";
import { createManualConnection } from "@/server/connect/manual-connect-service";
import { extractCardText } from "@/server/connect/card-ocr";
import type { AddContactActionState } from "./action-state";

/**
 * Server Actions for the unverified "add a contact" flow (2026-09-26,
 * docs/architecture/2026-09-26-unverified-connections.md) — manual entry,
 * OCR card scan, badge QR/barcode, badge NFC tap all converge on
 * `submitManualConnectionAction` below.
 *
 * SAME SECURITY NOTE EVERY OTHER `actions.ts` IN THIS APP CARRIES: a Server
 * Action is a POST endpoint reachable by anyone who can send the same
 * request, not only by somebody who loaded the page first. Every action here
 * re-derives the caller from a fresh `getAuthenticatedContext()`; the
 * "other party" is untrusted input regardless of which of the four input
 * modes produced it, and `createManualConnection`/`create_manual_connection`
 * (not this file) are what decide whether it may be added.
 */

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

async function requireUserId(): Promise<string> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    throw new UserFacingError("You need to be signed in to do that.");
  }
  return context.userId;
}

function textOrUndefined(formData: FormData, field: string): string | undefined {
  const value = formData.get(field);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The one entry point every input mode calls. `method` names which mode
 * produced this submission (`manual_entry`, `card_scan_ocr`, `badge_qr`,
 * `badge_nfc`) — it does not change what is validated or how, only what gets
 * recorded on the resulting `meetings` row.
 */
export async function submitManualConnectionAction(
  _prevState: AddContactActionState,
  formData: FormData,
): Promise<AddContactActionState> {
  const creatorUserId = await requireUserId();

  const parsedMethod = manualConnectionMethodSchema.safeParse(formData.get("method"));
  if (!parsedMethod.success) {
    return { error: "Choose how you're adding this contact." };
  }

  const parsedContact = manualContactSchema.safeParse({
    email: textOrUndefined(formData, "email"),
    phone_number: textOrUndefined(formData, "phone_number"),
    first_name: textOrUndefined(formData, "first_name"),
    last_name: textOrUndefined(formData, "last_name"),
    company_name: textOrUndefined(formData, "company_name"),
    company_role: textOrUndefined(formData, "company_role"),
  });
  if (!parsedContact.success) {
    return { error: "Check the details you entered and try again." };
  }
  if (parsedContact.data.email === undefined && parsedContact.data.phone_number === undefined) {
    return { error: "Add at least an email or a phone number." };
  }

  let location: { latitude: number; longitude: number; accuracyM: number } | undefined;
  const rawLat = formData.get("latitude");
  const rawLng = formData.get("longitude");
  const rawAccuracy = formData.get("accuracy_m");
  if (typeof rawLat === "string" && typeof rawLng === "string" && typeof rawAccuracy === "string") {
    const parsedLocation = manualConnectionLocationSchema.safeParse({
      latitude: Number(rawLat),
      longitude: Number(rawLng),
      accuracyM: Number(rawAccuracy),
    });
    // A malformed location is dropped, never a reason to refuse the whole
    // submission — location here is logging, never a gate (the architecture
    // doc's explicit decision). The person already saw and could clear it
    // client-side; a bad value reaching here is a bug to fail open on, not
    // closed, since the only thing at stake is a metadata field.
    if (parsedLocation.success) {
      location = parsedLocation.data;
    }
  }

  try {
    const result = await createManualConnection(creatorUserId, {
      method: parsedMethod.data,
      otherContact: parsedContact.data,
      location,
    });

    if (!result.ok) {
      return { error: result.message };
    }

    revalidatePath("/connections");
    return { success: true, connectionId: result.connectionId, otherUserId: result.otherUserId };
  } catch (error) {
    return { error: safeActionErrorMessage(error, "add-contact") };
  }
}

export interface CardScanResult {
  rawText: string;
  guess: { email: string | null; phoneNumber: string | null; name: string | null };
}

/**
 * Runs OCR over a photographed card/badge. Returns the raw text and modest
 * guesses (`card-ocr.ts`'s own header explains why they're deliberately
 * unconfident) for the client to pre-fill into the same form
 * `submitManualConnectionAction` reads — never auto-submitted.
 */
export async function extractCardPhotoAction(
  formData: FormData,
): Promise<{ ok: true; result: CardScanResult } | { ok: false; message: string }> {
  await requireUserId();

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a photo to scan." };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, message: "That photo is too large — try a smaller one." };
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await extractCardText(bytes);
    return { ok: true, result };
  } catch (error) {
    console.error("[add-contact] OCR extraction failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, message: "Couldn't read that photo. Try again or enter details manually." };
  }
}
