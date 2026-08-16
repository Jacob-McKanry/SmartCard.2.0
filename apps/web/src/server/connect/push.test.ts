import { describe, expect, it } from "vitest";

import { cardTapNotificationBody, redactPushTokens } from "./push";

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

describe("redactPushTokens", () => {
  /**
   * Expo embeds the device's push token in the prose of several rejection
   * messages, so logging `ticket.message` verbatim would write a live token —
   * a device's address — into the runtime log.
   */
  it("removes an ExponentPushToken from a vendor error string", () => {
    expect(
      redactPushTokens(
        "You are sending messages too frequently to device ExponentPushToken[abc123XYZ]",
      ),
    ).toBe("You are sending messages too frequently to device [redacted-push-token]");
  });

  it("removes the ExpoPushToken spelling too", () => {
    expect(redactPushTokens("bad token ExpoPushToken[zz-99]")).toBe(
      "bad token [redacted-push-token]",
    );
  });

  it("removes every token when a message names more than one", () => {
    const out = redactPushTokens("ExponentPushToken[a] and ExponentPushToken[b] both failed");
    expect(out).toBe("[redacted-push-token] and [redacted-push-token] both failed");
    expect(out).not.toContain("ExponentPushToken[");
  });

  it("keeps the operational signal — it redacts rather than dropping the message", () => {
    // §4.5 wants "sending too frequently" visible; throwing the whole message
    // away to protect the token would trade a privacy problem for a monitoring one.
    expect(redactPushTokens("MessageRateExceeded for ExponentPushToken[x]")).toContain(
      "MessageRateExceeded",
    );
  });

  it("passes through a message with no token, and undefined", () => {
    expect(redactPushTokens("MessageTooBig")).toBe("MessageTooBig");
    expect(redactPushTokens(undefined)).toBeUndefined();
  });
});
