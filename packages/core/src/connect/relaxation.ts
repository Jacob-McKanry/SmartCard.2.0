/**
 * Automatic radius relaxation (§4.3 amendment, Q18), as a pure function.
 *
 * THE PROBLEM IT SOLVES
 * Two people genuinely standing next to each other, in a basement ballroom or a
 * steel-framed conference hall, whose phones cannot agree on where they are.
 * Under §4.3 as originally written their only recourse is to keep trying and
 * keep failing, and the product looks broken at exactly the moment it is meant
 * to feel like magic.
 *
 * THE MECHANISM
 * When the same ordered presenter+scanner pair accumulates
 * `qr_relaxation_failure_threshold` (2) distance/accuracy rejections inside
 * `qr_relaxation_window_seconds` (600), the NEXT attempt by that same pair is
 * evaluated at `qr_relaxed_max_distance_m` (500) and
 * `qr_relaxed_max_accuracy_m` (150) instead of the normal thresholds. Nothing
 * else about §4.2 or §4.3 changes: same signature check, same freshness checks,
 * same ordering, same server-side computation, same fail-closed table.
 *
 * WHAT IT IS NOT
 * There is no human override, no host approval, no "connect anyway" button, and
 * nothing the client can ask for. Relaxation is decided entirely server-side
 * from the audit log, and the two phones are never told it happened — a relaxed
 * acceptance is indistinguishable from a normal one, and a relaxed rejection
 * carries the same generic message as any other. Telling a user "we widened the
 * radius for you" teaches the attack in one sentence: it announces that failing
 * repeatedly is rewarded.
 *
 * THE THREE PROPERTIES THAT KEEP IT FROM BEING A HOLE (§4.3 amendment)
 *  1. It does not escalate. Two rungs, normal and relaxed, and no third.
 *     Failing twice more at 500m does not widen it again. A mechanism that
 *     relaxed on every repeated failure would let anyone walk the radius up to
 *     citywide by being patient, which is the same attack as having no radius,
 *     executed slowly. `evaluateRelaxation` has no notion of a level; it
 *     returns a boolean.
 *  2. It cools down. After a pair's relaxed attempt resolves — success OR
 *     failure — that pair reverts to normal and cannot re-trigger for
 *     `qr_relaxation_cooldown_seconds` (3600). Without this, a determined pair
 *     could hold themselves permanently in relaxed mode by failing on purpose
 *     every few minutes.
 *  3. The relaxed radius stays far larger than the relaxed accuracy floor.
 *     Enforced in `config.ts`, not here, because it is a property of the
 *     configuration rather than of any one attempt.
 *
 * ELIGIBILITY IS TIGHTLY SCOPED, AND THAT SCOPING IS THE SECURITY PROPERTY
 * Only distance/accuracy rejections count (`RELAXATION_UNLOCKING_REASONS`).
 * A bad HMAC, an expired token, a consumed session, a block or an existing
 * connection unlocks nothing — otherwise an attacker could spend two junk
 * requests to buy a wider radius. The failures must also be the SAME ORDERED
 * PAIR, so failures cannot be pooled across victims.
 *
 * THIS IS DELIBERATELY ATTACKER-TRIGGERABLE, AND THAT IS SURVIVABLE
 * Anyone can fail twice on purpose, so two colluding remote users can reach
 * 500m whenever they like. Relaxation does not defend a boundary — it MOVES
 * one, from "same large room" to "same venue", for one attempt, for one pair,
 * once an hour. §4.7 already accepts deliberate collusion as residual risk (two
 * real people who both want a fake connection can simply meet), and 500m
 * remains a real proximity claim: it does not connect two people in different
 * neighbourhoods, let alone different cities. What would be unsurvivable is
 * escalation or persistence, which properties 1 and 2 remove. Tracked as
 * §4.7 threat 6.
 */

import type { VerificationConfig } from "./config";

/**
 * What the audit log says about this pair. Fetched by the I/O layer, evaluated
 * here — §4.3's judgment call is that relaxation state is DERIVED from
 * `connection_attempts` rather than stored in a table of its own, because a
 * second source of truth can disagree with the audit log, and disagreement
 * between an audit log and a live security decision is the worst class of bug
 * this design can have.
 */
export interface RelaxationHistory {
  /**
   * Rejections by this ordered pair, inside the window, whose reason is in
   * `RELAXATION_UNLOCKING_REASONS`. The filtering is the caller's job because
   * it is expressed most cheaply as a SQL predicate over the indexed columns.
   */
  unlockingFailuresInWindow: number;
  /** The most recent of those failures, recorded on the relaxed attempt so §4.4 question 3 can join them. */
  mostRecentUnlockingFailureId: string | null;
  /**
   * When this pair last had an attempt evaluated at the relaxed thresholds, of
   * any outcome. Null if never. This is the cooldown's input, and "of any
   * outcome" is the whole point of property 2 — a relaxed attempt that FAILED
   * must still start the cooldown, or failing on purpose becomes a way to stay
   * relaxed forever.
   */
  lastRelaxedAttemptAt: Date | null;
}

export interface RelaxationDecision {
  relaxed: boolean;
  /** Non-null only when `relaxed` is true. Written to `connection_attempts.relaxation_source_attempt_id`. */
  sourceAttemptId: string | null;
}

export function evaluateRelaxation(
  history: RelaxationHistory,
  config: VerificationConfig,
  now: Date,
): RelaxationDecision {
  const denied: RelaxationDecision = { relaxed: false, sourceAttemptId: null };

  // The master switch. One row disables the whole mechanism mid-event without a
  // deploy, which is the reason it is a row.
  if (!config.qr_relaxation_enabled) return denied;

  if (history.unlockingFailuresInWindow < config.qr_relaxation_failure_threshold) {
    return denied;
  }

  // Property 2, the cooldown. Note the direction of the comparison: relaxation
  // is denied while `elapsed < cooldown`, so a missing or unparseable
  // `lastRelaxedAttemptAt` must be handled explicitly rather than left to
  // arithmetic on a null — an accidental `NaN < cooldown` is false, which would
  // read as "cooldown elapsed" and hand out relaxation on every attempt.
  if (history.lastRelaxedAttemptAt !== null) {
    const elapsed = (now.getTime() - history.lastRelaxedAttemptAt.getTime()) / 1000;
    if (!Number.isFinite(elapsed) || elapsed < config.qr_relaxation_cooldown_seconds) {
      return denied;
    }
  }

  return { relaxed: true, sourceAttemptId: history.mostRecentUnlockingFailureId };
}

/**
 * The thresholds actually in force for one attempt, given the decision above.
 *
 * Kept as its own function so that the two rungs of the ladder are visible in
 * one place. There is no third branch here and there must never be one: a
 * `level` parameter, or a multiplier, is how "a rung, not a ladder" (§10)
 * becomes a ladder.
 */
export function thresholdsFor(
  decision: RelaxationDecision,
  config: VerificationConfig,
): { maxDistanceM: number; maxAccuracyM: number; radiusMode: "normal" | "relaxed" } {
  return decision.relaxed
    ? {
        maxDistanceM: config.qr_relaxed_max_distance_m,
        maxAccuracyM: config.qr_relaxed_max_accuracy_m,
        radiusMode: "relaxed",
      }
    : {
        maxDistanceM: config.qr_max_distance_m,
        maxAccuracyM: config.qr_max_accuracy_m,
        radiusMode: "normal",
      };
}
