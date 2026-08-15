import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * "Events attended", counted once, in SQL, for every surface that shows the
 * number.
 *
 * WHY THIS IS ITS OWN MODULE RATHER THAN A LINE IN TWO FILES
 *
 * It used to be two implementations of one question, and they disagreed. The
 * card preview counted in SQL (`card-preview-service.ts`'s `loadPreviewCounts`,
 * `count: "exact", head: true`); Profile derived its number in TypeScript from
 * `listAttendingEvents`, which caps at the 50 most recent RSVPs — so a person
 * with 51 qualifying RSVPs saw 50 on their own profile and the true figure on
 * the page strangers get, with nothing on either screen to explain the gap. The
 * cap was never wrong for the list it belongs to (that is a browse limit); it
 * was wrong as the input to a count.
 *
 * The fix is one function both call, rather than a second correct
 * implementation. Two implementations of the same number can drift again, and
 * this bug is only visible *because* two places counted differently.
 *
 * WHAT "ATTENDED" MEANS, AND WHY BOTH HALVES MATTER
 *
 * A `going` RSVP to an event whose `starts_at` is in the past.
 *
 *   - `going` is the only status the database itself treats as attendance —
 *     `private.shares_event_with()` branches on it, so it carries
 *     access-control weight and not merely display weight. `interested`,
 *     `pending`, `waitlist`, `denied` and `not_going` are not attendance.
 *   - An event that has not started has not been attended, however firmly it
 *     was answered.
 *
 * This counts RSVPs, which is what the app can observe: nothing in this schema
 * records whether a person physically turned up. The caption noun everywhere
 * this number appears says "events attended" because that is the closest honest
 * description of it, and the number is never inflated past what the rows
 * support.
 *
 * WHY IT TAKES A CLIENT RATHER THAN CHOOSING ONE
 *
 * The two callers hold different clients on purpose and this function must not
 * decide for them. Profile passes the signed-in caller's own RLS-bound client,
 * so the `event_rsvps` select policy ("your own rows, and your connections'")
 * is the thing scoping the answer. The card preview has no caller identity at
 * all and passes the service-role client, for the reasons its own header sets
 * out at length. Taking a `SupabaseClient` keeps that decision at the call
 * site, where it is reviewable, instead of burying a service-role reach inside
 * a helper.
 *
 * WHY `now` IS AN ARGUMENT
 *
 * Both callers already read the clock once per request and pass the same
 * instant to every time-dependent check they make, so that two numbers on one
 * page cannot be computed against two different "now"s. Reading the clock in
 * here would quietly take that away from them.
 */

/**
 * How many past events the subject answered `going` to.
 *
 * THROWS rather than returning a fallback, and every caller must decide what to
 * do about that. There is deliberately no `?? 0`: zero is a claim ("they have
 * attended nothing"), not an absence, and a screen that prints it after a failed
 * read is stating something the app does not know. `DESIGN.md` §7 rules that
 * out, so the honest degradation is to omit the number — which the caller can
 * do and this function cannot.
 *
 * @param supabase The client whose visibility should decide the answer. See the
 *   header: Profile passes its own RLS-bound client; the card preview passes the
 *   service role because its reader has no identity.
 * @param userId The subject. Not a filter a request supplies — both callers
 *   resolve it themselves (from the session, or from a card code / signed QR
 *   token).
 * @param now One instant for the whole request.
 */
export async function countEventsAttended(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
): Promise<number> {
  /*
   * `head: true` with `count: "exact"`: PostgREST answers with a
   * `Content-Range` header and an EMPTY BODY. No row, no id, no event title
   * crosses the wire — the `select()` argument only shapes the join. That
   * property is what makes this query safe to run on the card preview's
   * service-role client, where there is no policy behind it, and it is the
   * reason not to "simplify" this into a query that returns rows and counts
   * them in TypeScript. Doing that is precisely the bug this module exists to
   * have fixed.
   *
   * `events!inner` makes the join a filter rather than a left join, so
   * `starts_at` can be compared without any `events` column being returned.
   */
  const { count, error } = await supabase
    .from("event_rsvps")
    .select("id, events!inner(starts_at)", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "going")
    .lt("events.starts_at", now.toISOString());

  if (error) {
    throw new Error(`Failed to count events attended: ${error.message}`, { cause: error });
  }

  // A null count with no error means the header was missing or unparsed.
  // Treated as a failure rather than as zero, for the reason above: a number
  // that quietly defaults is a claim nobody made.
  if (typeof count !== "number") {
    throw new Error("Events-attended count came back without a count.");
  }
  return count;
}
