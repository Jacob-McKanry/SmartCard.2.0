"use server";

import { revalidatePath } from "next/cache";
import { uuidSchema } from "@smartcard/types";

import { getAuthenticatedContext, type AuthenticatedContext } from "@/server/auth/current-user";
import { safeActionErrorMessage, UserFacingError } from "@/server/errors";
import { importEventAttendees } from "@/server/events/attendee-import-service";
import type { AttendeeImportActionState } from "./action-state";

/**
 * The Server Action behind the guest-list import.
 *
 * THE SECURITY NOTE EVERY `actions.ts` IN THIS APP CARRIES, AND WHY IT MATTERS
 * MORE HERE THAN ANYWHERE ELSE
 *
 * A Server Action is a POST endpoint reachable by anyone who can send the same
 * request, not only by somebody who loaded the page first
 * (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`,
 * "Security"). Rendering the import wizard behind a host-only page is not a
 * security boundary. So this re-derives the caller from a fresh
 * `getAuthenticatedContext()` and works through that context's RLS-bound client
 * — never the service role.
 *
 * And then it stops. Nothing here decides whether the caller may import.
 * Whether they are an active verified host, whether they host *this*
 * non-cancelled event, whether the attestation was given, whether the file is
 * inside the row cap, and whether they have any of today's ten imports left are
 * five checks made inside `public.import_event_attendees` (20260827130000) from
 * values it reads itself. If every line below were wrong, the database would
 * still refuse to write one stranger's phone number into an event the caller
 * does not host.
 *
 * WHY THE PAYLOAD IS PARSED ROWS AND NOT THE UPLOADED FILE
 *
 * The CSV is read, mapped and reviewed in the browser; what crosses to the
 * server is the array the host actually confirmed. Three reasons, in the order
 * they matter:
 *
 *   1. WHAT THE HOST SAW IS WHAT GETS IMPORTED. Re-parsing server-side would
 *      mean the preview and the write are two separate interpretations of the
 *      same bytes, and a disagreement between them — one different guess about
 *      a quoted field, one column mapped differently — would import something
 *      nobody reviewed. For a feature whose entire lawful basis is a host
 *      looking at a list and attesting to it, that is the wrong failure mode.
 *   2. IT IS SUBSTANTIALLY SMALLER. A real Luma export has thirty columns and
 *      lists a guest once per ticket; the confirmed payload keeps seven fields
 *      and one row per person. The 6MB `serverActions.bodySizeLimit` already
 *      set in `next.config.ts` (for profile photos) covers a full 5000-row
 *      payload several times over.
 *   3. IT COSTS NOTHING IN TRUST. The rows are host-supplied either way — a
 *      host who wants to import a hand-written list can, and the migration
 *      header says so in as many words. The gates that matter never looked at
 *      the row content in the first place.
 *
 * `eventId` arrives as a *bound* leading argument (`action.bind(null, eventId)`),
 * the pattern the forms guide recommends for "which row" arguments. It is still
 * untrusted: the RPC re-derives from the session whether the caller hosts it.
 */

async function requireContext(): Promise<AuthenticatedContext> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    // Fail closed (CLAUDE.md): an action invoked with no valid session is
    // refused outright, never treated as an anonymous request for nothing.
    throw new UserFacingError("You need to be signed in to do that.");
  }
  return context;
}

/**
 * Only a message deliberately written for a person crosses to the browser;
 * anything else becomes one generic sentence with the real error logged
 * server-side. See `@/server/errors` for why this is opt-in rather than a
 * filter over raw database text.
 */
function messageOf(error: unknown): string {
  return safeActionErrorMessage(error, "events/import");
}

/**
 * Imports the guest list the host reviewed on the previous step.
 *
 * Expects two form fields:
 *
 *   `rows`      A JSON array of confirmed import rows, as produced by
 *               `normaliseImportRows`. Shape-checked in the service against
 *               `attendeeImportPayloadSchema` before it reaches the database.
 *   `attested`  The attestation checkbox. A real checkbox in a real form, not a
 *               boolean the client computes, because it is the lawful basis for
 *               holding contact details belonging to people who have never
 *               heard of this product. `"on"` is what an unchecked-by-default
 *               HTML checkbox sends when ticked; anything else is not consent.
 *
 * The import is an UPSERT on `(event_id, email)`, so re-uploading a corrected
 * file fixes rows rather than duplicating them, and rows somebody has already
 * claimed are left alone entirely — those belong to that person now, and a host
 * re-uploading must not overwrite what they edited or resurrect the personal
 * details the claim destroyed.
 */
export async function importAttendeesAction(
  eventId: string,
  _prevState: AttendeeImportActionState,
  formData: FormData,
): Promise<AttendeeImportActionState> {
  const context = await requireContext();

  // Checked before anything else so a malformed id fails as a bad request
  // rather than as a database refusal — and so the `revalidatePath` below can
  // never be handed an arbitrary string.
  const parsedEventId = uuidSchema.safeParse(eventId);
  if (!parsedEventId.success) {
    return { error: "That event isn't available." };
  }

  // Strictly equal to `"on"`. `Boolean(formData.get("attested"))` would be true
  // for the string `"false"`, `"no"`, or anything else a hand-built POST cares
  // to send — and the one field in this form that must not be loosely coerced
  // is the one that records a claim of authority over other people's contacts.
  const attested = formData.get("attested") === "on";

  const rawRows = formData.get("rows");
  if (typeof rawRows !== "string" || rawRows === "") {
    return { error: "There were no guests to import. Go back and choose a file." };
  }

  let rows: unknown;
  try {
    rows = JSON.parse(rawRows);
  } catch {
    // Deliberately not surfacing the parser's own message, which quotes the
    // offending input back — and the offending input here is somebody's guest
    // list. The service's schema check produces the same class of message for
    // the same class of problem.
    return {
      error: "Something about that guest list didn't come through correctly. Go back and try again.",
    };
  }
  // The service's schema would reject this too. It is caught here for the
  // message, not the safety: a payload that is not an array at all means this
  // form is broken, and "go back and re-check the columns" — what the service
  // says for a row-shaped problem — would send the host to fix a mapping that
  // is not the fault.
  if (!Array.isArray(rows)) {
    return {
      error: "Something about that guest list didn't come through correctly. Go back and try again.",
    };
  }
  // An empty array is NOT rejected here. It is a real case — a file whose
  // status column excluded every row — and the service refuses it with a
  // message that says which two things to check, so that the rule lives in one
  // place and every future caller gets it rather than only this form.

  try {
    const summary = await importEventAttendees(
      context.supabase,
      parsedEventId.data,
      // Handed over unvalidated on purpose: the service owns the row schema, so
      // there is one place that decides what an import row is rather than two
      // that can drift. It refuses before the database is called.
      rows,
      attested,
    );

    revalidatePath(`/events/${parsedEventId.data}`);
    return { success: true, summary };
  } catch (error) {
    return { error: messageOf(error) };
  }
}
