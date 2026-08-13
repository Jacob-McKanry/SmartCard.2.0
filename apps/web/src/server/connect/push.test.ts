import { describe, expect, it } from "vitest";

import { cardTapNotificationBody } from "./push";

/**
 * §7.5 constrains what a push notification may contain, and the constraint is
 * not about taste: content transits Expo's servers and renders on a lock screen
 * that anyone holding the phone reads without unlocking. §4.5's amendment sets
 * the ceiling at the tapper's display name and the event — "no location, ever",
 * stated there precisely so that a later "helpful" addition of a coarse
 * position is recognised as the change it would be.
 *
 * §4.5 also requires coalescing: a card left on a table at a conference can be
 * tapped repeatedly, and thirty pushes in a minute trains the owner to ignore
 * the alert that matters — which would destroy the detective control the
 * notification exists to provide (§4.7 threat 7).
 */

describe("cardTapNotificationBody", () => {
  it("names the tapper and the event, and nothing else", () => {
    expect(cardTapNotificationBody({ tapperDisplayName: "Sam Rivera", otherTapCount: 0 })).toBe(
      "Sam Rivera just tapped your card.",
    );
  });

  it("rolls up repeated taps instead of implying a single one", () => {
    expect(cardTapNotificationBody({ tapperDisplayName: "Sam Rivera", otherTapCount: 1 })).toBe(
      "Sam Rivera and 1 other just tapped your card.",
    );
    expect(cardTapNotificationBody({ tapperDisplayName: "Sam Rivera", otherTapCount: 4 })).toBe(
      "Sam Rivera and 4 others just tapped your card.",
    );
  });

  it("treats a negative count as none rather than producing nonsense", () => {
    expect(cardTapNotificationBody({ tapperDisplayName: "Sam", otherTapCount: -3 })).toBe(
      "Sam just tapped your card.",
    );
  });

  it("never contains anything resembling a location", () => {
    const body = cardTapNotificationBody({ tapperDisplayName: "Sam Rivera", otherTapCount: 2 });
    expect(body).not.toMatch(/\b(at|near|latitude|longitude|street|avenue|venue|located)\b/i);
    // No coordinate pair, no decimal degrees.
    expect(body).not.toMatch(/-?\d+\.\d+/);
  });

  it("never contains a token, id, or anything that looks like one", () => {
    const body = cardTapNotificationBody({ tapperDisplayName: "Sam Rivera", otherTapCount: 0 });
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(body).not.toMatch(/ExponentPushToken/);
  });
});
