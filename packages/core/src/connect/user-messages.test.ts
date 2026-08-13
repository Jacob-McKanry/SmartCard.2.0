import { describe, expect, it } from "vitest";

import { REJECTION_REASONS } from "./rejection-reasons";
import { userFacingMessage } from "./user-messages";

/**
 * §4.2 step 7 as an executable rule.
 *
 * "The user sees only a plain message ... never the distance, radius, or the
 * other party's location, which would let someone probe for a person's position
 * by repeated scanning."
 *
 * A chatty error message on this endpoint is a location leak. If a rejection
 * returned the computed distance, anyone holding a valid token could stand in
 * three places, read three distances, and trilaterate the presenter's position
 * to within metres — a people-finder inside a product built on not having one.
 */

describe("userFacingMessage", () => {
  it("has a message for every reason, so no reason falls through to a raw code", () => {
    for (const reason of REJECTION_REASONS) {
      const message = userFacingMessage(reason);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toBe(reason);
    }
  });

  it("never contains a number", () => {
    // Distances, radii, accuracies, thresholds, counts, seconds remaining — all
    // of them are numbers, and none of them may reach a caller. Forbidding
    // digits outright is a blunt rule that cannot be argued around later.
    for (const reason of REJECTION_REASONS) {
      expect(userFacingMessage(reason)).not.toMatch(/\d/);
    }
  });

  it("never names a threshold, a coordinate, or a distance concept", () => {
    const forbidden =
      /\b(metre|meter|metres|meters|km|kilometre|radius|distance|latitude|longitude|coordinate|accuracy|gps|threshold|limit)\b/i;
    for (const reason of REJECTION_REASONS) {
      expect(userFacingMessage(reason)).not.toMatch(forbidden);
    }
  });

  it("never reveals that the radius was relaxed, in either direction", () => {
    // §4.3 amendment: telling a user "we widened the radius for you" teaches the
    // attack in one sentence, because it announces that failing repeatedly is
    // rewarded. A relaxed rejection must read exactly like any other.
    const forbidden = /\b(relax|relaxed|widen|widened|extended|again for you|second chance)\b/i;
    for (const reason of REJECTION_REASONS) {
      expect(userFacingMessage(reason)).not.toMatch(forbidden);
    }
  });

  it("never tells anyone they have been blocked", () => {
    // A policy branch on `blocked_user_id` is kept out of the `blocks` read
    // policy for exactly this reason (20260809211200): telling someone they
    // were blocked is a safety problem and an invitation to make a second
    // account. A message here would leak the same fact by a different route.
    expect(userFacingMessage("blocked")).not.toMatch(/block/i);
  });

  it("gives a blocked caller the same words as an ordinary failure", () => {
    // Indistinguishability, not just silence: if `blocked` had its own unique
    // wording, the reason would be recoverable by comparison.
    expect(userFacingMessage("blocked")).toBe(userFacingMessage("session_not_found"));
  });

  it("gives the same words for every card refusal, so the endpoint is not a card-code oracle", () => {
    // Distinguishing "no such card" from "revoked" would let a guesser confirm
    // which 12-hex suffixes exist — the search the §4.6 per-user rate limit
    // exists to make hopeless. Do not "improve" this by telling the tapper the
    // card was revoked.
    expect(userFacingMessage("card_not_found")).toBe(userFacingMessage("card_revoked"));
    expect(userFacingMessage("card_not_found")).toBe(userFacingMessage("card_unassigned"));
  });

  it("says the same thing whether the presenter was too far, imprecise, or stale", () => {
    // Distinguishing these tells an attacker which knob to turn: "move closer"
    // versus "wait for a better fix" versus "their heartbeat died".
    const proximity = userFacingMessage("too_far");
    expect(userFacingMessage("presenter_accuracy_too_low")).toBe(proximity);
    expect(userFacingMessage("presenter_location_stale")).toBe(proximity);
    expect(userFacingMessage("presenter_location_missing")).toBe(proximity);
    expect(userFacingMessage("gps_check_failed")).toBe(proximity);
  });

  it("does describe the caller's OWN device, which leaks nothing about anyone else", () => {
    // The rule is not "say nothing" — it is "say nothing about the other party
    // or the comparison". A caller's own phone already knows its own accuracy.
    expect(userFacingMessage("scanner_location_missing")).toMatch(/location/i);
    expect(userFacingMessage("scanner_accuracy_too_low")).not.toBe(
      userFacingMessage("presenter_accuracy_too_low"),
    );
  });
});
