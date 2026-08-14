import { describe, expect, it } from "vitest";

import {
  deriveLocationSharingStatus,
  locationSharingSummary,
  type LocationSharingInputs,
} from "./location-sharing";

/** A fully "nothing has happened yet" baseline, tweaked per test. */
function inputs(overrides: Partial<LocationSharingInputs> = {}): LocationSharingInputs {
  return {
    locationVisibility: "participants_only",
    viewerConsent: false,
    otherConsent: false,
    hiddenByPrivacyOverride: false,
    ...overrides,
  };
}

describe("deriveLocationSharingStatus", () => {
  it("is not-offered while location_visibility is participants_only, regardless of consent", () => {
    expect(
      deriveLocationSharingStatus(
        inputs({ locationVisibility: "participants_only", viewerConsent: true, otherConsent: true }),
      ),
    ).toBe("not-offered");
  });

  it("is waiting-on-you once mutuals is proposed but the viewer has not consented", () => {
    expect(
      deriveLocationSharingStatus(inputs({ locationVisibility: "mutuals", viewerConsent: false })),
    ).toBe("waiting-on-you");
  });

  it("is waiting-on-them once the viewer has consented but the other participant has not", () => {
    expect(
      deriveLocationSharingStatus(
        inputs({ locationVisibility: "mutuals", viewerConsent: true, otherConsent: false }),
      ),
    ).toBe("waiting-on-them");
  });

  it("is shared only once both the viewer and the other participant have consented", () => {
    expect(
      deriveLocationSharingStatus(
        inputs({ locationVisibility: "mutuals", viewerConsent: true, otherConsent: true }),
      ),
    ).toBe("shared");
  });

  it("is blocked-by-privacy when both consents are true but a privacy override is set — the RLS policy would still deny it", () => {
    expect(
      deriveLocationSharingStatus(
        inputs({
          locationVisibility: "mutuals",
          viewerConsent: true,
          otherConsent: true,
          hiddenByPrivacyOverride: true,
        }),
      ),
    ).toBe("blocked-by-privacy");
  });

  it("a privacy override does not upgrade not-offered into blocked-by-privacy — the toggle is still the primary gate", () => {
    // If nobody proposed sharing in the first place, the privacy override
    // isn't the reason mutuals can't see it — the missing proposal is. This
    // pins the check ORDER (visibility gate first) as much as the outcome.
    expect(
      deriveLocationSharingStatus(
        inputs({ locationVisibility: "participants_only", hiddenByPrivacyOverride: true }),
      ),
    ).toBe("not-offered");
  });

  it("never returns shared when a privacy override is set, however consent is arranged", () => {
    // Adversarial-style sweep, matching how the Connect Flow suite tests its
    // state machines: every consent combination, one invariant asserted.
    for (const viewerConsent of [true, false]) {
      for (const otherConsent of [true, false]) {
        const status = deriveLocationSharingStatus(
          inputs({
            locationVisibility: "mutuals",
            viewerConsent,
            otherConsent,
            hiddenByPrivacyOverride: true,
          }),
        );
        expect(status).not.toBe("shared");
      }
    }
  });
});

describe("locationSharingSummary", () => {
  it("names the other participant in every status's copy", () => {
    const statuses = [
      "not-offered",
      "waiting-on-you",
      "waiting-on-them",
      "shared",
      "blocked-by-privacy",
    ] as const;
    for (const status of statuses) {
      expect(locationSharingSummary(status, "Priya")).toContain("Priya");
    }
  });
});
