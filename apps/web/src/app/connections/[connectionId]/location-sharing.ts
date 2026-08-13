import type { LocationVisibility } from "@smartcard/types";

/**
 * Pure derivation of what the location-sharing UI should tell a participant,
 * factored out of the page component the same way
 * `apps/web/src/app/connect/present/presenter-state.ts` is factored out of
 * `presenter-flow.tsx` — this is genuinely stateless logic ("given these
 * RLS-readable values, what do I tell this specific viewer") and is worth
 * unit-testing without a database, a browser, or a signed-in session.
 *
 * WHY THIS NEEDS TO EXIST AS ITS OWN FUNCTION AT ALL
 *
 * The raw rows this reads from — `meetings.location_visibility`,
 * two `meeting_participants.location_share_consent` values,
 * `meetings.is_private`, and two `meeting_participants.marked_private` values
 * — do not, on their own, distinguish "waiting on me" from "waiting on them":
 * that distinction only exists once you know *which* participant is the
 * viewer, and RLS is symmetric (either participant can read both consent
 * rows, per `20260809211200`'s "read participants of meetings you can see"
 * policy). Computing "which one is me" inline in the component risks the
 * exact bug a boolean-flip is famous for — showing "waiting on them" to the
 * person everyone else is actually waiting on. Computed once, here, and
 * tested the same way the Connect Flow's state machines were (README,
 * "Connect Flow landed" — 193 adversarial tests, not happy-path ones).
 *
 * WHY `blocked-by-privacy` IS A DISTINCT STATE FROM `not-offered`
 *
 * `meeting_locations`' own RLS policy (§3.2) requires FOUR independent
 * conditions for a mutual to ever see coordinates: `location_visibility =
 * 'mutuals'`, `is_private = false`, unanimous `location_share_consent`, and
 * the viewer being a mutual of both parties. This feature only builds UI for
 * two of those switches (`location_visibility` and each participant's own
 * `location_share_consent` — see the build-order task). `is_private` has no
 * control in this pass (judgment call, recorded in the build report) and
 * `marked_private` is exposed as a separate, one-way-from-the-other-person
 * veto. A UI that only reflected the two controls it renders would tell a
 * participant "shared" in a state where the database would actually refuse
 * to show anyone anything — an honesty gap this function exists to close by
 * folding the privacy overrides in as an equal, and overriding, input.
 */

export type LocationSharingStatus =
  /** `location_visibility` is still `participants_only` — nobody has proposed sharing. */
  | "not-offered"
  /** Proposed and not blocked, but the viewer has not consented yet. */
  | "waiting-on-you"
  /** Proposed and not blocked, viewer has consented, the other participant has not. */
  | "waiting-on-them"
  /** Proposed, not blocked, and both participants have consented. */
  | "shared"
  /**
   * Sharing was proposed and both consents may even be in place, but a
   * privacy override (`meetings.is_private`, or either participant's
   * `marked_private`) means mutuals still cannot see it. Distinct from
   * `not-offered` because the *sharing* setting says yes; something else
   * says no, and the UI should say so rather than imply the toggle alone
   * decides the outcome.
   */
  | "blocked-by-privacy";

export interface LocationSharingInputs {
  locationVisibility: LocationVisibility;
  viewerConsent: boolean;
  otherConsent: boolean;
  /** True if `meetings.is_private`, or either participant's `marked_private`, is set. */
  hiddenByPrivacyOverride: boolean;
}

export function deriveLocationSharingStatus(inputs: LocationSharingInputs): LocationSharingStatus {
  if (inputs.locationVisibility !== "mutuals") {
    return "not-offered";
  }
  if (inputs.hiddenByPrivacyOverride) {
    return "blocked-by-privacy";
  }
  if (!inputs.viewerConsent) {
    return "waiting-on-you";
  }
  if (!inputs.otherConsent) {
    return "waiting-on-them";
  }
  return "shared";
}

/**
 * User-facing copy for each status, parameterised by the other participant's
 * display name so the same enum drives both the summary line and its tests.
 */
export function locationSharingSummary(
  status: LocationSharingStatus,
  otherName: string,
): string {
  switch (status) {
    case "not-offered":
      return `Not shared with mutual connections. Only you and ${otherName} can see this.`;
    case "waiting-on-you":
      return `${otherName} proposed sharing this with mutual connections — waiting on your agreement.`;
    case "waiting-on-them":
      return `You've agreed to share this with mutual connections — waiting on ${otherName}.`;
    case "shared":
      return `Shared with mutual connections who are connected to both you and ${otherName}.`;
    case "blocked-by-privacy":
      return `Sharing was proposed, but a privacy setting is currently hiding this meeting from everyone but you and ${otherName}.`;
  }
}
