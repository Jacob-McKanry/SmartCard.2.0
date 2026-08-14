import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AttemptLogRecord,
  CandidateEventRecord,
  CardRecord,
  CommitInput,
  CommitResult,
  ConnectStore,
  RateLimitRequest,
  RejectionReason,
  RelaxationHistory,
  SessionRecord,
  VerificationConfig,
} from "@smartcard/core";
import { CONNECT_CONFIG_KEYS, parseVerificationConfig } from "@smartcard/core";
import type { VerificationMethodId } from "@smartcard/types";

import { serviceRoleClient } from "@/server/supabase/service-role-client";

/**
 * The production `ConnectStore` (§4.1's I/O port) — the one place in the app
 * that reaches the database on behalf of the connection-verification flow.
 *
 * WHY THIS USES THE SERVICE ROLE, AND WHY THAT IS NOT A BACKDOOR
 *
 * Read `service-role-client.ts` first: it says the service role is not "an
 * admin login", it is the absence of the second lock, and adding a caller is a
 * decision rather than a convenience. This is that decision, made explicitly,
 * and it is the second caller in the app after `ensureUser()`.
 *
 * It is not optional. `20260809211200_rls_policies_graph_and_meetings.sql` has
 * NO INSERT policy and no INSERT grant on `connections`, `meetings`,
 * `meeting_participants`, `meeting_locations` or `connection_sessions` for any
 * client role, deliberately — that absence is the structural defence against
 * §4.7 threat 4 (mass fake-account farming), and its instruction is blunt:
 * never add a second path that writes connections. So the verification service
 * cannot write the graph through a user's own RLS-bound client, and the correct
 * response is emphatically NOT to add a policy that would let it: that policy
 * would be reachable by any farmed account calling PostgREST directly, with no
 * API route, no rate limit and no GPS check in the way.
 *
 * `connection_attempts`, `app_config` and `rate_limit_events` are the same
 * shape for the same reason (§3.5) — an audit log its subjects can edit is not
 * an audit log, and thresholds a client can read tell an attacker exactly how
 * far away they may stand.
 *
 * WHAT THAT COSTS, AND WHAT PAYS IT BACK
 * Every query below is outside RLS, so its correctness rests on this file. The
 * mitigations are that it is small, that it takes every identity as an argument
 * derived server-side from `getAuthenticatedContext()` rather than from a
 * request body, and — most importantly — that the ONE operation which writes
 * the graph does not build a statement here at all. It calls
 * `public.create_verified_connection`, a `security invoker` function whose
 * validation re-runs inside the write transaction (20260813210300). A mistake
 * in this file cannot produce a half-written connection, because this file does
 * not write connections.
 */

interface SessionRow {
  id: string;
  method: string;
  presenter_user_id: string;
  status: string;
  current_nonce: string | null;
  previous_nonce: string | null;
  nonce_issued_at: string | null;
  presenter_latitude: number | null;
  presenter_longitude: number | null;
  presenter_accuracy_m: number | null;
  presenter_location_at: string | null;
  device_id: string | null;
  expires_at: string;
}

const SESSION_COLUMNS =
  "id, method, presenter_user_id, status, current_nonce, previous_nonce, nonce_issued_at, " +
  "presenter_latitude, presenter_longitude, presenter_accuracy_m, presenter_location_at, device_id, expires_at";

function toDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    method: row.method as VerificationMethodId,
    presenterUserId: row.presenter_user_id,
    status: row.status as SessionRecord["status"],
    currentNonce: row.current_nonce,
    previousNonce: row.previous_nonce,
    nonceIssuedAt: toDate(row.nonce_issued_at),
    presenterLatitude: row.presenter_latitude,
    presenterLongitude: row.presenter_longitude,
    presenterAccuracyM: row.presenter_accuracy_m,
    presenterLocationAt: toDate(row.presenter_location_at),
    deviceId: row.device_id,
    // `expires_at` is NOT NULL in the schema, so a bad value here is a
    // corrupted row rather than an absent one. Falling back to `new Date(0)`
    // makes such a row read as already expired, which is the fail-closed
    // direction: an unreadable expiry must not read as "no expiry".
    expiresAt: toDate(row.expires_at) ?? new Date(0),
  };
}

export function supabaseConnectStore(client: SupabaseClient = serviceRoleClient()): ConnectStore {
  return {
    async loadConfig(): Promise<VerificationConfig> {
      const { data, error } = await client
        .from("app_config")
        .select("key, value")
        .in("key", [...CONNECT_CONFIG_KEYS]);

      if (error) {
        // Thrown, not defaulted. `parseVerificationConfig`'s header explains
        // why: a default here is a security threshold chosen by whoever last
        // edited a TypeScript file, silently overriding the row an operator
        // thought they were tuning.
        throw new Error(`Failed to read app_config: ${error.message}`, { cause: error });
      }

      return parseVerificationConfig((data ?? []) as { key: string; value: unknown }[]);
    },

    async createSession(input): Promise<SessionRecord> {
      const { data, error } = await client
        .from("connection_sessions")
        .insert({
          method: input.method,
          presenter_user_id: input.presenterUserId,
          status: "active",
          current_nonce: input.nonce,
          nonce_issued_at: input.now.toISOString(),
          device_id: input.deviceId,
          expires_at: input.expiresAt.toISOString(),
        })
        .select(SESSION_COLUMNS)
        .single<SessionRow>();

      if (error) {
        throw new Error(`Failed to create connection session: ${error.message}`, { cause: error });
      }
      return toSessionRecord(data);
    },

    async loadSession(sessionId: string): Promise<SessionRecord | null> {
      const { data, error } = await client
        .from("connection_sessions")
        .select(SESSION_COLUMNS)
        .eq("id", sessionId)
        .maybeSingle<SessionRow>();

      if (error) {
        throw new Error(`Failed to load connection session: ${error.message}`, { cause: error });
      }
      return data === null ? null : toSessionRecord(data);
    },

    /**
     * One statement writes the fresh fix and, when rotation is due, rotates the
     * nonce — moving the current value to `previous_nonce` so a scan already in
     * flight is still accepted (§4.2 step 2's grace window).
     *
     * The `eq("presenter_user_id")` and `eq("status", "active")` predicates are
     * the authorization: a caller can only heartbeat a session they own and
     * that is still live. Zero rows updated returns null and the route refuses.
     * Doing it as a predicate rather than a read-then-write means a session
     * consumed between the two cannot be revived by a heartbeat that was
     * already in flight.
     */
    async heartbeat(input): Promise<SessionRecord | null> {
      const current = await this.loadSession(input.sessionId);
      if (
        current === null ||
        current.presenterUserId !== input.presenterUserId ||
        current.status !== "active"
      ) {
        return null;
      }

      const rotationDue =
        current.nonceIssuedAt === null ||
        (input.now.getTime() - current.nonceIssuedAt.getTime()) / 1000 >= input.rotationSeconds;

      const patch: Record<string, unknown> = {
        presenter_latitude: input.latitude,
        presenter_longitude: input.longitude,
        presenter_accuracy_m: input.accuracyM,
        presenter_location_at: input.capturedAt.toISOString(),
      };

      if (rotationDue) {
        patch.previous_nonce = current.currentNonce;
        patch.current_nonce = input.nextNonce;
        patch.nonce_issued_at = input.now.toISOString();
      }

      const { data, error } = await client
        .from("connection_sessions")
        .update(patch)
        .eq("id", input.sessionId)
        .eq("presenter_user_id", input.presenterUserId)
        .eq("status", "active")
        .select(SESSION_COLUMNS)
        .maybeSingle<SessionRow>();

      if (error) {
        throw new Error(`Failed to record heartbeat: ${error.message}`, { cause: error });
      }
      return data === null ? null : toSessionRecord(data);
    },

    /**
     * Mirrors `private.are_connected` exactly, including its `status = 'active'`
     * filter: removing a connection must actually remove what it granted, and a
     * removed edge must not block a pair from reconnecting after meeting again.
     */
    async areConnected(a: string, b: string): Promise<boolean> {
      const [low, high] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
      const { count, error } = await client
        .from("connections")
        .select("id", { count: "exact", head: true })
        .eq("user_a_id", low)
        .eq("user_b_id", high)
        .eq("status", "active");

      if (error) {
        throw new Error(`Failed to check existing connection: ${error.message}`, { cause: error });
      }
      return (count ?? 0) > 0;
    },

    /**
     * BOTH directions, in one query. A block by either party must stop the
     * connection: the person who blocked obviously must not be reconnected, and
     * the person who was blocked must not be able to route around it by being
     * the one who scans.
     */
    async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
      // Expressed as two `in` filters rather than a `.or()` string, on purpose.
      // PostgREST's `.or()` takes a filter EXPRESSION, so building one by
      // interpolating values is string-concatenating a query — the exact
      // pattern §4.7 threat 5 rules out ("parameterized queries only"). These
      // two ids are server-derived uuids today, so nothing is exploitable right
      // now; the point is that the safe form should not depend on that staying
      // true.
      //
      // `in × in` matches the four combinations (a,a), (a,b), (b,a), (b,b). The
      // two self-pairs cannot exist — `blocks_no_self_block` is a CHECK
      // constraint — so this is exactly "a blocked b, or b blocked a".
      const { count, error } = await client
        .from("blocks")
        .select("blocker_user_id", { count: "exact", head: true })
        .in("blocker_user_id", [a, b])
        .in("blocked_user_id", [a, b]);

      if (error) {
        throw new Error(`Failed to check blocks: ${error.message}`, { cause: error });
      }
      return (count ?? 0) > 0;
    },

    async findCardByCode(cardCode: string): Promise<CardRecord | null> {
      const { data, error } = await client
        .from("cards")
        .select("id, card_code, status, owner_user_id")
        .eq("card_code", cardCode)
        .maybeSingle<{
          id: string;
          card_code: string;
          status: string;
          owner_user_id: string | null;
        }>();

      if (error) {
        throw new Error(`Failed to resolve card: ${error.message}`, { cause: error });
      }
      if (data === null) return null;

      return {
        id: data.id,
        cardCode: data.card_code,
        status: data.status as CardRecord["status"],
        ownerUserId: data.owner_user_id,
      };
    },

    async countSessionRejections(sessionId: string): Promise<number> {
      const { count, error } = await client
        .from("connection_attempts")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId)
        .eq("outcome", "rejected");

      if (error) {
        throw new Error(`Failed to count session rejections: ${error.message}`, { cause: error });
      }
      return count ?? 0;
    },

    /**
     * `revoked`, not `expired`. The status set here is a deliberate signal in
     * the audit trail: `expired` means time ran out, `revoked` means we killed
     * it. Five failures against one session is the second, and being able to
     * tell them apart afterwards is the difference between "sessions time out a
     * lot" and "someone was hammering sessions".
     */
    async burnSession(sessionId: string): Promise<void> {
      const { error } = await client
        .from("connection_sessions")
        .update({ status: "revoked" })
        .eq("id", sessionId)
        .eq("status", "active");

      if (error) {
        throw new Error(`Failed to burn session: ${error.message}`, { cause: error });
      }
    },

    /**
     * The one indexed query §4.3's "relaxation state is derived, not stored"
     * judgment call rests on, served by
     * `connection_attempts_pair_created_at_idx` (20260813210000).
     *
     * Note both halves are scoped to the ORDERED pair (presenter, scanner) —
     * that scoping is what stops an attacker pooling failures across victims to
     * unlock a wider radius against a target they have never failed against.
     */
    async loadRelaxationHistory(input): Promise<RelaxationHistory> {
      const since = new Date(input.now.getTime() - input.windowSeconds * 1000).toISOString();

      const failures = await client
        .from("connection_attempts")
        .select("id, created_at")
        .eq("presenter_user_id", input.presenterUserId)
        .eq("scanner_user_id", input.scannerUserId)
        .eq("outcome", "rejected")
        .in("rejection_reason", [...input.unlockingReasons])
        .gte("created_at", since)
        .order("created_at", { ascending: false });

      if (failures.error) {
        throw new Error(`Failed to read relaxation history: ${failures.error.message}`, {
          cause: failures.error,
        });
      }

      // "Of any outcome" is load-bearing: a relaxed attempt that FAILED must
      // still start the cooldown, or failing on purpose becomes a way to stay
      // permanently relaxed (§4.3 amendment, property 2).
      const lastRelaxed = await client
        .from("connection_attempts")
        .select("created_at")
        .eq("presenter_user_id", input.presenterUserId)
        .eq("scanner_user_id", input.scannerUserId)
        .eq("radius_mode", "relaxed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ created_at: string }>();

      if (lastRelaxed.error) {
        throw new Error(`Failed to read relaxation cooldown: ${lastRelaxed.error.message}`, {
          cause: lastRelaxed.error,
        });
      }

      const rows = failures.data ?? [];
      return {
        unlockingFailuresInWindow: rows.length,
        mostRecentUnlockingFailureId: rows[0]?.id ?? null,
        lastRelaxedAttemptAt:
          lastRelaxed.data === null ? null : toDate(lastRelaxed.data.created_at),
      };
    },

    /**
     * Which events could a just-verified meeting between these two people have
     * happened at (§2.6)? Candidates only — see the port's declaration for why
     * the geofence comparison and the tie-break stay in `packages/core`.
     *
     * TWO QUERIES RATHER THAN ONE JOIN, ON PURPOSE. PostgREST can express an
     * inner join through an embedded resource, but "the SAME event has a
     * `going` row for user A *and* a separate `going` row for user B" is a
     * per-group condition, not a per-row one — an embed would happily return an
     * event that only one of them is going to, and the intersection would have
     * to be redone here anyway with a filter that LOOKS redundant and therefore
     * eventually gets deleted. Asking the two questions separately makes the
     * intersection the visible, single place the "both" in rule 1 lives.
     *
     * WHY THE UPPER TIME BOUND IS APPLIED HERE AND NOT IN THE FILTER
     * The bound is `ends_at ?? starts_at + windowHoursIfNoEnd`, which is a
     * COALESCE over two columns. Expressing that in PostgREST means a `.or()`
     * built by interpolating values into a filter expression string — the
     * string-concatenated-query pattern §4.7 threat 5 rules out, and the reason
     * `isBlockedEitherWay` above is written as `in × in`. The lower bound and
     * the venue-coordinates test are ordinary column filters and do run in SQL,
     * so the set that reaches this loop is already small: only events both
     * people are going to that had already started.
     *
     * ERRORS THROW, exactly like every other method here. That is not in
     * tension with event tagging being non-fatal: this method's job is to
     * report honestly that it could not answer, and `event-tagging.ts` in core
     * is the one place that decides a failed answer means "no event" rather
     * than "no connection". Swallowing it here instead would hide a broken
     * query from the one caller equipped to log it.
     */
    async findCandidateEventsForConnection(input: {
      presenterUserId: string;
      scannerUserId: string;
      now: Date;
      windowHoursIfNoEnd: number;
    }): Promise<CandidateEventRecord[]> {
      const rsvps = await client
        .from("event_rsvps")
        .select("event_id, user_id")
        // `going` only. `interested`, `waitlist` and `pending` are explicitly
        // not attendance — the same line `private.shares_event_with()` draws,
        // for the same reason: wanting to go to an event is not being at it.
        .eq("status", "going")
        .in("user_id", [input.presenterUserId, input.scannerUserId]);

      if (rsvps.error) {
        throw new Error(`Failed to read event RSVPs: ${rsvps.error.message}`, {
          cause: rsvps.error,
        });
      }

      const presenterGoing = new Set<string>();
      const scannerGoing = new Set<string>();
      for (const row of (rsvps.data ?? []) as { event_id: string; user_id: string }[]) {
        if (row.user_id === input.presenterUserId) presenterGoing.add(row.event_id);
        if (row.user_id === input.scannerUserId) scannerGoing.add(row.event_id);
      }
      const sharedEventIds = [...presenterGoing].filter((id) => scannerGoing.has(id));

      // The common case by a wide margin: most connections happen nowhere near
      // a shared event. Returning early keeps that path at one query.
      if (sharedEventIds.length === 0) {
        return [];
      }

      const events = await client
        .from("events")
        .select("id, starts_at, ends_at, latitude, longitude")
        .in("id", sharedEventIds)
        .lte("starts_at", input.now.toISOString())
        // An event whose venue was never set cannot be geofence-matched against
        // anything. Dropped as a candidate, not treated as an error — §2.6
        // allows an event to be created before its venue is confirmed.
        .not("latitude", "is", null)
        .not("longitude", "is", null);

      if (events.error) {
        throw new Error(`Failed to read candidate events: ${events.error.message}`, {
          cause: events.error,
        });
      }

      const nowMs = input.now.getTime();
      const candidates: CandidateEventRecord[] = [];

      for (const row of (events.data ?? []) as {
        id: string;
        starts_at: string;
        ends_at: string | null;
        latitude: number | null;
        longitude: number | null;
      }[]) {
        const startsAt = toDate(row.starts_at);
        // An unreadable `starts_at` on a NOT NULL column is a corrupt row. It
        // is skipped rather than defaulted, matching how `toSessionRecord`
        // treats an unreadable expiry: an unparseable bound must never read as
        // "no bound".
        if (startsAt === null) continue;

        const endsAt = row.ends_at === null ? null : toDate(row.ends_at);
        const endMs =
          endsAt === null
            ? startsAt.getTime() + input.windowHoursIfNoEnd * 3_600_000
            : endsAt.getTime();
        if (nowMs > endMs) continue;

        // Re-checked in TypeScript even though the query filtered on it: the
        // port promises core two non-null numbers, and `select()` gives back a
        // nullable type. This is the narrowing that makes that promise true
        // rather than asserted.
        if (row.latitude === null || row.longitude === null) continue;

        candidates.push({ id: row.id, latitude: row.latitude, longitude: row.longitude });
      }

      return candidates;
    },

    async consumeRateLimit(request: RateLimitRequest): Promise<boolean> {
      const { data, error } = await client.rpc("rate_limit_consume", {
        p_action: request.action,
        p_subject_kind: request.subjectKind,
        p_subject_key: request.subjectKey,
        p_limit: request.limit,
        p_window_seconds: request.windowSeconds,
      });

      if (error) {
        // Fail CLOSED. A rate limiter that cannot answer must not answer "yes":
        // the state in which the limiter is broken is exactly the state in which
        // something is hammering it.
        throw new Error(`Rate limit check failed: ${error.message}`, { cause: error });
      }
      return data === true;
    },

    /**
     * Returns the new row's id, or null if logging itself failed.
     *
     * Logging never throws, and that is the one place in this file where
     * swallowing an error is right. A rejection that cannot be logged must still
     * be a rejection: throwing here would convert "we refused you and could not
     * write it down" into a 500, which is both a worse answer for the user and a
     * way to make the audit log's own failure invisible. The failure is written
     * to the server log instead, where it is a monitoring problem rather than a
     * user-facing one.
     */
    async logAttempt(record: AttemptLogRecord): Promise<string | null> {
      const { data, error } = await client
        .from("connection_attempts")
        .insert({
          session_id: record.sessionId,
          method: record.method,
          scanner_user_id: record.scannerUserId,
          presenter_user_id: record.presenterUserId,
          outcome: record.outcome,
          rejection_reason: record.rejectionReason,
          distance_m: record.distanceM,
          scanner_accuracy_m: record.scannerAccuracyM,
          presenter_accuracy_m: record.presenterAccuracyM,
          radius_config_used_m: record.radiusConfigUsedM,
          accuracy_config_used_m: record.accuracyConfigUsedM,
          radius_mode: record.radiusMode,
          relaxation_source_attempt_id: record.relaxationSourceAttemptId,
          ip_hash: record.ipHash,
          user_agent: record.userAgent,
        })
        .select("id")
        .single<{ id: string }>();

      if (error) {
        console.error("[connect] failed to write connection_attempts row", {
          outcome: record.outcome,
          reason: record.rejectionReason,
          message: error.message,
        });
        return null;
      }
      return data.id;
    },

    /**
     * The atomic multi-table write. One RPC, one transaction — see
     * `create-verified-connection.ts` and the migration header for why this
     * cannot be six PostgREST calls.
     */
    async commitVerifiedConnection(input: CommitInput): Promise<CommitResult> {
      const { data, error } = await client.rpc("create_verified_connection", {
        p_method: input.method,
        p_presenter_user_id: input.presenterUserId,
        p_scanner_user_id: input.scannerUserId,
        p_session_id: input.sessionId,
        p_occurred_at: input.occurredAt.toISOString(),
        p_event_id: input.eventId,
        p_latitude: input.latitude,
        p_longitude: input.longitude,
        p_accuracy_m: input.accuracyM,
        p_distance_m: input.distanceM,
        p_scanner_accuracy_m: input.scannerAccuracyM,
        p_presenter_accuracy_m: input.presenterAccuracyM,
        p_radius_config_used_m: input.radiusConfigUsedM,
        p_accuracy_config_used_m: input.accuracyConfigUsedM,
        p_radius_mode: input.radiusMode,
        p_relaxation_source_attempt_id: input.relaxationSourceAttemptId,
        p_ip_hash: input.ipHash,
        p_user_agent: input.userAgent,
      });

      if (error) {
        return { ok: false, reason: `rpc_error: ${error.message}` };
      }

      const result = data as {
        ok?: boolean;
        reason?: string;
        connection_id?: string;
        meeting_id?: string;
        session_id?: string;
        attempt_id?: string | null;
        reconnected?: boolean;
      } | null;

      if (
        result === null ||
        result.ok !== true ||
        typeof result.connection_id !== "string" ||
        typeof result.meeting_id !== "string" ||
        typeof result.session_id !== "string"
      ) {
        // Anything other than a complete success shape is treated as a refusal.
        // The alternative — reading whichever fields happen to be present — is
        // how a partially-understood response becomes a connection nobody
        // verified.
        return { ok: false, reason: result?.reason ?? "unknown" };
      }

      return {
        ok: true,
        connectionId: result.connection_id,
        meetingId: result.meeting_id,
        sessionId: result.session_id,
        attemptId: result.attempt_id ?? null,
        reconnected: result.reconnected === true,
      };
    },
  };
}

/** Re-exported for the routes, which log a reason without importing core's internals. */
export type { RejectionReason };
