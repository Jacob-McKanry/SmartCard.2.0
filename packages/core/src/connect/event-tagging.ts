/**
 * Which event, if any, an already-accepted QR meeting happened at (§2.6).
 *
 * READ THIS FIRST, BECAUSE IT IS THE ONLY THING ABOUT THIS FILE THAT MATTERS:
 * NOTHING HERE IS A SECURITY CONTROL, AND NOTHING HERE MAY EVER BECOME ONE.
 *
 * `meetings.event_id` is display and aggregate metadata — "you met 4 people at
 * this event". It is computed strictly AFTER `qr-verifier.ts` has already
 * decided `ok: true`, from the same two GPS fixes the gate already used, and it
 * cannot change that decision, cannot produce a `RejectionReason`, and cannot
 * abort a success. `resolveAutoTaggedEventId` below therefore swallows every
 * error it can encounter and returns `null` — which is exactly what it returns
 * when there simply is no matching event. A verified connection must never be
 * lost because a metadata lookup had a bad day.
 *
 * That inversion is worth stating plainly, because it is the opposite of
 * CLAUDE.md's fail-closed rule and looks like a violation of it at a glance.
 * Fail-closed means: when a check that decides whether two people may connect
 * cannot be completed, refuse. This is not such a check. The failure modes here
 * are "tagged when it should not have been" and "not tagged when it should have
 * been", and the second is free. So the fail-safe direction is `null`, and the
 * only thing that would be genuinely wrong is guessing.
 *
 * THE RULE (confirmed by the project owner; this file implements it, it does
 * not choose it). A meeting is tagged to event E iff ALL of:
 *
 *   1. BOTH people hold an `event_rsvps` row for E with `status = 'going'`.
 *      Deliberately stricter than "was standing near the venue": two strangers
 *      who happen to meet on the pavement outside a conference did not meet at
 *      that conference. Answered by the store.
 *   2. The verification's own `now` is inside E's time window —
 *      `starts_at <= now <= (ends_at ?? starts_at + windowHoursIfNoEnd)`.
 *      Answered by the store.
 *   3. E has venue coordinates. An event created before its venue was set can
 *      never match; it is skipped as a candidate, not an error. Answered by the
 *      store (`CandidateEventRecord` has non-null coordinates by construction).
 *   4. BOTH fixes — the presenter's heartbeat and the scanner's scan-time fix —
 *      are within `event_geofence_radius_m` of E's coordinates. Answered here.
 *   5. If more than one candidate satisfies all of the above, the meeting is
 *      left UNTAGGED. Answered here, and see `selectAutoTaggedEvent`.
 */

import { haversineDistanceM, type LatLng } from "../geo/haversine";
import type { CandidateEventRecord, ConnectStore } from "./ports";

export interface AutoTagInput {
  /** Events the store has already established both people were `going` to, during, with coordinates. */
  candidates: readonly CandidateEventRecord[];
  /** The presenter's last heartbeat position. */
  presenter: LatLng | null;
  /** The scanner's scan-time position. */
  scanner: LatLng | null;
  /** `event_geofence_radius_m`. */
  geofenceRadiusM: number;
}

/**
 * The matching rule itself, as a pure function over candidates and two points.
 *
 * WHY AMBIGUITY RESOLVES TO `null` RATHER THAN TO A WINNER
 * Two events at the same venue at the same time, both people going to both, is
 * not a hypothetical — a conference with parallel tracks in one building is
 * exactly that, and so is a venue hosting back-to-back events that overlap by
 * ten minutes. Every tie-break available here is a guess dressed as a rule:
 * "nearest venue centroid" picks by which room the coordinates were rounded
 * toward, "earliest start" picks the one that is more likely to be over. A
 * wrong tag is a durable, visible, wrong claim about where someone was, sitting
 * on a row nobody will ever revisit. An absent tag is a feature not firing.
 * Given the two, declining is strictly better, and it costs nothing precisely
 * because this is not a security property.
 *
 * Candidates are de-duplicated by id first, so a store that returns the same
 * event twice reads as one match rather than as ambiguity.
 */
export function selectAutoTaggedEvent(input: AutoTagInput): string | null {
  const { candidates, presenter, scanner, geofenceRadiusM } = input;

  // A radius that is not a usable positive number is treated as "cannot
  // evaluate", not as "no limit". `NaN` is the specific danger, for the reason
  // `config.ts` gives: every comparison against it is false, so `distance >
  // radius` would be false and EVERY candidate would match — which, with rule
  // 5, would mostly produce ambiguity, but with a single candidate would tag a
  // meeting to an event on the other side of the country.
  if (!Number.isFinite(geofenceRadiusM) || geofenceRadiusM <= 0) {
    return null;
  }

  // Both fixes are always present on the QR accept path — the GPS gate rejects
  // otherwise — so this is a guard against a future caller, not against a state
  // reachable today. Null in, null out: no fix means nothing to match against.
  if (presenter === null || scanner === null) {
    return null;
  }

  const matchedIds = new Set<string>();
  for (const candidate of candidates) {
    // `haversineDistanceM` returns null, never NaN, for an unusable coordinate
    // — a candidate whose stored latitude is out of range or corrupt is simply
    // not a match. See its header for why null rather than NaN.
    const presenterDistanceM = haversineDistanceM(presenter, candidate);
    const scannerDistanceM = haversineDistanceM(scanner, candidate);
    if (presenterDistanceM === null || scannerDistanceM === null) {
      continue;
    }

    // BOTH, not either, and not a midpoint. The claim being recorded is "these
    // two people met at this event", and one person inside the geofence with
    // the other 400m up the road does not support it.
    if (presenterDistanceM <= geofenceRadiusM && scannerDistanceM <= geofenceRadiusM) {
      matchedIds.add(candidate.id);
    }
  }

  if (matchedIds.size !== 1) {
    return null;
  }
  // `.size === 1`, so the iterator's first value exists; `?? null` only exists
  // to satisfy `noUncheckedIndexedAccess`-style strictness at the type level.
  return [...matchedIds][0] ?? null;
}

export interface ResolveAutoTagInput extends Omit<AutoTagInput, "candidates"> {
  store: ConnectStore;
  presenterUserId: string;
  scannerUserId: string;
  /** The verification's own clock, so the window test matches the attempt being recorded. */
  now: Date;
  /** `event_auto_tag_default_window_hours` — how long an event with no `ends_at` counts as running. */
  windowHoursIfNoEnd: number;
  /**
   * Called when the lookup failed rather than found nothing. Optional, and
   * NEVER a way to change the result: a caller that ignores it still gets
   * `null` and still gets its connection.
   */
  onError?: (error: unknown) => void;
}

/**
 * The whole step, as one call the verifier can make in one line: ask the store
 * for candidates, apply the rule, and — the part that matters — never throw.
 *
 * The try/catch is wrapped around BOTH the store call and the matching, not
 * just the store call. A malformed candidate row (a string where a number
 * belongs, a null id) should behave exactly like a query failure, because from
 * the accept path's point of view they are the same event: the tag could not be
 * determined, so there is no tag. Anything narrower would leave a shape of bad
 * data that could still unwind past a successful verification.
 */
export async function resolveAutoTaggedEventId(input: ResolveAutoTagInput): Promise<string | null> {
  try {
    const candidates = await input.store.findCandidateEventsForConnection({
      presenterUserId: input.presenterUserId,
      scannerUserId: input.scannerUserId,
      now: input.now,
      windowHoursIfNoEnd: input.windowHoursIfNoEnd,
    });

    return selectAutoTaggedEvent({
      candidates: candidates ?? [],
      presenter: input.presenter,
      scanner: input.scanner,
      geofenceRadiusM: input.geofenceRadiusM,
    });
  } catch (error) {
    input.onError?.(error);
    return null;
  }
}
