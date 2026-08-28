import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  attendeeImportPayloadSchema,
  attendeeImportSummarySchema,
  type AttendeeImportSummary,
} from "@smartcard/types";

import { UserFacingError } from "@/server/errors";

/**
 * The service layer (§1.7) for guest-list import —
 * `docs/architecture/2026-08-22-event-attendee-import.md` §2.
 *
 * TWO FUNCTIONS, AND EVERYTHING THEY DO IS TRANSLATION
 *
 * It validates the shape of the payload, calls `public.import_event_attendees`
 * through the caller's own RLS-bound client, and turns the database's refusal
 * codes into sentences. It decides nothing. Whether this person may import at
 * all, whether they host this particular event, whether an attestation was
 * given, whether the file is within the row cap and whether they have any
 * imports left today are all decided inside the function (20260827130000) from
 * values it reads itself — so a host who skips this app entirely and calls the
 * RPC with hand-written rows meets exactly the same five gates.
 *
 * WHY THE SERVICE ROLE APPEARS NOWHERE IN THIS FILE
 *
 * `public.event_attendee_imports` is the most sensitive table in this database:
 * it holds contact details for people who never signed up and never consented
 * to us storing anything. It has RLS enabled *and forced* with zero policies
 * and zero grants, so ordinary queries cannot reach it at all — which means the
 * only way to write is the `security definer` RPC, and the only way to make
 * that RPC do anything is to be a caller it accepts. Reaching for the service
 * role here would not be a shortcut past a policy; it would be the one thing
 * capable of turning a table nobody can read into a table somebody can.
 *
 * WHAT THIS FILE DELIBERATELY CANNOT DO: READ BACK. There is no `list` or `get`
 * below and there cannot be one, because no read path to that table exists
 * anywhere yet. The host already holds the CSV they uploaded, so reading it
 * back through us would add nothing except a second copy of the PII behind a
 * second set of checks. The status screen (§3.9) shows counts, which is what
 * the import itself answers with.
 */

/**
 * Whether the CALLER may upload a guest list at all.
 *
 * FOR DRAWING A SCREEN, NEVER FOR DECIDING ONE. The import RPC re-derives this
 * from the JWT and refuses without it, so a `true` from here buys nobody
 * anything — it exists so the import page can show a verified host the wizard
 * and an unverified one an explanation, instead of showing everyone a form that
 * fails at the end. Treating this as the gate would be a mistake of the "the
 * button was hidden" kind: `importEventAttendees` is reachable without ever
 * loading the page.
 *
 * SELF-ONLY BY CONSTRUCTION. `public.is_verified_host()` takes no argument and
 * reads `private.current_user_id()`, so there is no version of this that
 * answers about somebody else — asking "is Sam a verified host?" is not
 * expressible. That matters because the underlying column is deliberately
 * absent from the `users` SELECT grant (20260814230000): widening the grant to
 * let a screen read it would have disclosed the flag to every connection and
 * co-attendee, none of whom have any need for it. The RPC is the narrow hole
 * cut for exactly this one caller asking about exactly themselves.
 *
 * Fails CLOSED (CLAUDE.md). Any error answers `false`, which shows a real
 * verified host the "you can't import yet" explanation during an outage. That
 * is the correct direction to be wrong in: the alternative is showing somebody
 * a wizard, letting them map thirty columns, and refusing at the database after
 * they have attested.
 */
export async function isVerifiedHost(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_verified_host");
  if (error) {
    console.error("[events/import] is_verified_host failed", {
      error: error.message,
      cause: JSON.stringify(error),
    });
    return false;
  }
  return data === true;
}

/**
 * Write one guest list into one event.
 *
 * @param rows Typed `unknown` on purpose. Its only caller holds the result of
 *   `JSON.parse` on a form field, and this function is the thing that decides
 *   what an import row is — accepting a typed array here would mean the shape
 *   is defined in two places (the caller's cast and the schema below) that can
 *   drift, and the cast would be the one that lies. Callers should pass what
 *   they have and read the thrown message.
 *
 *   In practice it is the output of `@smartcard/core`'s `normaliseImportRows` —
 *   deduplicated on lowercased email, with `declined` and `invited` guests
 *   dropped. That filter is not re-applied here and cannot be: the status
 *   column belongs to whichever platform exported the file, and by the time
 *   rows reach this point they are the rows the host confirmed on the review
 *   screen. See the migration header for why the same filter is absent from the
 *   RPC as well, and what the honest consequence of that is.
 * @param attested The host's assertion that they may contact these people about
 *   this event. Passed through as a value rather than assumed, because the RPC
 *   refuses unless it is literally `true` and `attested_at` is NOT NULL — there
 *   is no code path that records a contact without a recorded claim of
 *   authority to share it. It is per-import, not per-account, so it cannot be
 *   granted once and forgotten.
 *
 * @returns Counts only — never a list of who. In particular
 *   `skipped_already_claimed` says *how many* of the file's guests already hold
 *   an account, never which ones.
 *
 * @throws {UserFacingError} For every refusal a host can act on. The messages
 *   are written for a person and are the only strings from this file allowed to
 *   reach a browser; anything else becomes the generic sentence in
 *   `@/server/errors`.
 */
export async function importEventAttendees(
  supabase: SupabaseClient,
  eventId: string,
  rows: unknown,
  attested: boolean,
): Promise<AttendeeImportSummary> {
  // FIRST, and not only because it is the cheapest. It is the one refusal in
  // this function the host can act on: a checkbox they did not tick. Checking
  // the payload first would answer a forgotten checkbox with "something about
  // that guest list didn't come through correctly" whenever both were wrong,
  // which sends somebody looking for a problem in their file that is not there.
  //
  // Refused here as well as in the RPC, and that is not redundant: the RPC
  // consumes one of the host's ten daily imports BEFORE doing the work, on
  // purpose, so that probing is not free. Spending a host's budget on a
  // checkbox is a bad trade, and it is a bug this side rather than an attack.
  if (!attested) {
    throw new UserFacingError(
      "Confirm that you're allowed to contact these guests about this event before importing.",
    );
  }

  // Shape only. The point is not to protect the database — see the payload
  // schema's own header — it is that `v_row ->> 'first_name'` answers `null`
  // for a key that is missing or misspelled, so a mis-built payload would
  // quietly import a guest list with every name blank instead of failing.
  const parsedRows = attendeeImportPayloadSchema.safeParse(rows);
  if (!parsedRows.success) {
    throw new UserFacingError(
      "Something about that guest list didn't come through correctly. Go back and re-check the columns.",
      { cause: parsedRows.error },
    );
  }

  // Same argument as the attestation, one step further along. An empty array is
  // a perfectly valid call: the RPC would accept it, loop over nothing, report
  // four zeroes — and still have spent one of the host's ten daily imports,
  // because the budget is consumed before the loop. A file that mapped to no
  // importable guests is a thing to tell the host about, not a thing to charge
  // them for.
  if (parsedRows.data.length === 0) {
    throw new UserFacingError(
      "There were no guests to import. Check that the right column is mapped to the email address, and that the statuses you chose match what's in the file.",
    );
  }

  const { data, error } = await supabase.rpc("import_event_attendees", {
    p_event_id: eventId,
    p_rows: parsedRows.data,
    p_attested: attested,
  });

  if (error) {
    throw importRefusal(error);
  }

  // Parsed rather than cast. A summary is four numbers rendered straight to the
  // host as "142 guests imported", and a shape that quietly disagreed would
  // render `undefined imported` — the sort of thing that reads as a broken page
  // rather than as the bug it is. If this ever fails, the RPC's contract
  // changed and that is worth an exception.
  const summary = attendeeImportSummarySchema.safeParse(data);
  if (!summary.success) {
    throw new Error("import_event_attendees returned an unexpected shape", {
      cause: summary.error,
    });
  }
  return summary.data;
}

/**
 * The database's refusal codes, turned into sentences.
 *
 * Each message says no more than the caller has earned, which for this RPC is
 * an easy line to hold: every refusal below is about the caller's own standing
 * or their own file, and none of them answers a question about anybody else.
 * The raw error is kept as `cause` so `safeActionErrorMessage` logs it in full
 * server-side.
 */
function importRefusal(error: { code?: string; message: string }): Error {
  switch (error.code) {
    // 42501 — the RPC's single refusal for "not signed in", "not a verified
    // host", and "not the host of this event". It answers identically for all
    // three ON PURPOSE, so that calling it with a guessed event id cannot be
    // used to find out whether that id exists or who runs it. Splitting it into
    // three friendlier messages here would rebuild exactly the probe the RPC
    // declines to be, so it stays merged — a verified host who owns the event
    // never sees this, and anybody who does see it learns only that they were
    // refused.
    case "42501":
      return new UserFacingError(
        "You can't import guests into this event. Importing needs a verified host account and this event has to be one you're hosting.",
        { cause: error },
      );

    // 53400 — the per-host daily budget (`rate_limit_event_import_per_host_day`,
    // 10 by default). The number is not named: `app_config` is unreadable to
    // `authenticated` by design, so any figure written here would be a copy
    // that goes stale the moment somebody raises the real one.
    case "53400":
      return new UserFacingError(
        "You've hit today's import limit. Try again tomorrow, or get in touch if you need to import more than that.",
        { cause: error },
      );

    // 22023 — the RPC raises this for three things: no attestation, `p_rows`
    // not being a JSON array, and the file exceeding `event_import_max_rows`.
    // The first two cannot happen from this app: the attestation is refused
    // above before the call, and the payload is a parsed array by this line. So
    // in practice this is the row cap, and the message says so. If either of
    // the other two ever became reachable, the host would see a slightly wrong
    // sentence about file size rather than a wrong outcome — the import is
    // refused either way, and nothing is written.
    case "22023":
      return new UserFacingError(
        "That guest list is too big to import in one go. Split it into smaller files and upload them one after another.",
        { cause: error },
      );

    // 55000 — an `app_config` row is missing, so the RPC failed closed rather
    // than importing with no cap or writing a null expiry. That is our bug, not
    // the host's; it gets the generic sentence and a full server-side log.
    default:
      return new Error(`Failed to import the guest list: ${error.message}`, { cause: error });
  }
}
