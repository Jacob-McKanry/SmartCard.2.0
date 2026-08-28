import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ownAttendedEventsSchema } from "@smartcard/types";

/**
 * C5's service layer — `docs/architecture/2026-08-22-event-attendee-import.md`
 * §3.8/§4.3. One function, wrapping `public.own_attended_events()`
 * (20260828150000): the caller's own claimed guest-list rows, read back for
 * the event page's "you were on the guest list" note.
 *
 * WHY THIS IS ITS OWN FILE RATHER THAN A THIRD FUNCTION IN `claim-service.ts`
 *
 * `claim-service.ts`'s own header commits to "two functions, one per RPC" for
 * the read/write pair that share §3.6's indistinguishable-refusal posture —
 * both take a caller-supplied token, both can be pointed at somebody else's
 * row, both are rate-limited. `own_attended_events()` takes no argument, can
 * only ever answer about the caller's own rows, and carries no rate limit
 * (see that migration's header) — it is a different kind of read, not a third
 * instance of the same one, so it gets its own file rather than diluting what
 * that header promises.
 *
 * WHY THIS RETURNS A `Set`, NOT THE RAW ROWS
 *
 * The event page's only question is "is THIS event in the caller's claimed
 * set" — `claimed_at` is not rendered anywhere yet (C5 has no "my attended
 * events" list screen, only a per-event chip). A `Set<string>` is the type
 * that makes the one call site (`.has(eventId)`) obviously correct rather
 * than an array a caller has to remember to `.some(...)` over correctly every
 * time.
 */

/**
 * The event ids the caller has claimed a guest-list profile for.
 *
 * FAILS CLOSED TO AN EMPTY SET ON ANY ERROR — never throws. Showing the
 * "you were on the guest list" note is a nice-to-have, not a security
 * decision, but CLAUDE.md's fail-closed rule still applies to the direction
 * of the failure: an unreadable result must never SHOW a claim of attendance
 * that cannot be verified. The event page must not go down over this either
 * — same posture `getEventHostProfile` and `getConnectionsAttending` already
 * take for their own reads on this same page.
 */
export async function listOwnAttendedEventIds(supabase: SupabaseClient): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.rpc("own_attended_events");

    if (error) {
      console.error("[events/attended] own_attended_events failed", {
        error: error.message,
        cause: JSON.stringify(error),
      });
      return new Set();
    }

    const parsed = ownAttendedEventsSchema.safeParse(data);
    if (!parsed.success) {
      console.error("[events/attended] own_attended_events returned an unexpected shape", {
        error: parsed.error.message,
      });
      return new Set();
    }

    return new Set(parsed.data.map((row) => row.event_id));
  } catch (error) {
    console.error("[events/attended] own_attended_events threw", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Set();
  }
}
