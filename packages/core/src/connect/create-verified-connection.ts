/**
 * §4.1's single entry point to the social graph.
 *
 * "One function performs the graph write ... It accepts only a successful
 * outcome *produced by a verifier* — no API handler assembles a connection
 * itself, making 'connect these two users because the client asked me to'
 * unrepresentable in the type system."
 *
 * The signature below is that sentence, mechanised. `VerifiedOutcome` carries a
 * brand no consumer of this package can construct (see `verification.ts` and
 * `internal/seal.ts`), so this function is uncallable with an object a route
 * handler made up. Combined with the database side — no INSERT policy and no
 * INSERT grant on `connections`, `meetings`, `meeting_participants`,
 * `meeting_locations` or `connection_sessions` for any client role
 * (20260809211200) — there are exactly two locks on the same door, and neither
 * depends on the other holding.
 *
 * WHAT IT DOES NOT DO, AND MUST NOT START DOING
 *  * It does not re-run verification. It is not a second gate; it is the write
 *    that a gate authorised. Adding checks here would create the impression
 *    that a verifier's outcome is advisory.
 *  * It does not decide anything from `location`. The coordinates it forwards
 *    were already the input to the GPS gate; re-deriving anything from them
 *    here would be a second, unreviewed use of the same data.
 *  * It never reads `live_locations` or any proximity data, now or after §8
 *    ships. §8.6 threat 8 names this as an explicit invariant: reusing a
 *    "recent" self-reported position to spare someone a fresh GPS fix would
 *    quietly convert a long-lived, low-stakes, spoofable value into the proof
 *    that a meeting happened, defeating §4.7 threat 2 completely.
 */

import type { ConnectStore } from "./ports";
import type { VerifiedOutcome } from "./verification";

export class ConnectionCommitError extends Error {
  constructor(readonly reason: string) {
    super(`The verified connection could not be committed: ${reason}`);
    this.name = "ConnectionCommitError";
  }
}

export interface CreatedConnection {
  connectionId: string;
  meetingId: string;
  sessionId: string;
  /** True when a previously-removed edge was re-activated by this fresh verification. */
  reconnected: boolean;
}

/**
 * Performs the atomic multi-table write: consume the session, insert the
 * meeting, insert both participants, insert the location if one was captured,
 * create or re-activate the connection, and log the success — all in ONE
 * transaction, via `public.create_verified_connection` (20260813210300).
 *
 * WHY THE TRANSACTION IS IN THE DATABASE AND NOT HERE
 * `supabase-js` has no client-side multi-statement transaction. Six sequential
 * PostgREST calls are six independent transactions, and the partial states that
 * produces are security-relevant, not cosmetic — the worst of them leaves the
 * meeting written and the session still `active`, which is §4.7 threat 1
 * (screenshot-and-forward) reopened by a dropped network connection. The
 * migration's header enumerates the rest. A `plpgsql` function runs inside one
 * transaction by construction, which is the whole reason that function exists.
 *
 * A refusal from the commit is thrown rather than returned. By this point the
 * verifier has already said yes, so a refusal means the world changed
 * underneath us — a block that appeared, a concurrent redeem, a session
 * consumed by another request between the check and the write. That is
 * exceptional in the literal sense and the caller must not be able to ignore
 * it; the API routes catch it, log the rejection, and return the same generic
 * message as any other failure.
 */
export async function createVerifiedConnection(
  store: ConnectStore,
  outcome: VerifiedOutcome,
): Promise<CreatedConnection> {
  const result = await store.commitVerifiedConnection({
    method: outcome.method,
    presenterUserId: outcome.counterpartUserId,
    scannerUserId: outcome.initiatorUserId,
    sessionId: outcome.evidence.sessionId,
    occurredAt: new Date(),
    eventId: outcome.evidence.eventId,
    latitude: outcome.location?.latitude ?? null,
    longitude: outcome.location?.longitude ?? null,
    accuracyM: outcome.location?.accuracyM ?? null,
    distanceM: outcome.evidence.distanceM,
    scannerAccuracyM: outcome.evidence.scannerAccuracyM,
    presenterAccuracyM: outcome.evidence.presenterAccuracyM,
    radiusConfigUsedM: outcome.evidence.radiusConfigUsedM,
    accuracyConfigUsedM: outcome.evidence.accuracyConfigUsedM,
    radiusMode: outcome.evidence.radiusMode,
    relaxationSourceAttemptId: outcome.evidence.relaxationSourceAttemptId,
    ipHash: (outcome.evidence.ipHash as string | null | undefined) ?? null,
    userAgent: (outcome.evidence.userAgent as string | null | undefined) ?? null,
  });

  if (!result.ok) {
    throw new ConnectionCommitError(result.reason);
  }

  return {
    connectionId: result.connectionId,
    meetingId: result.meetingId,
    sessionId: result.sessionId,
    reconnected: result.reconnected,
  };
}
