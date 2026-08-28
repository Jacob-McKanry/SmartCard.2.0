import { getAuthenticatedContext } from "@/server/auth/current-user";
import { getClaimableImport } from "@/server/events/claim-service";

import { ClaimNotAvailable } from "./claim-not-available";
import { ClaimReview } from "./claim-review";
import { ClaimSignIn } from "./claim-sign-in";
import { ClaimTeaser } from "./claim-teaser";

/**
 * `/claim/[token]` — where an emailed guest-list claim link lands. C4 of
 * `docs/architecture/2026-08-22-event-attendee-import.md`'s §4.2 flow, built
 * on top of C2 (`get_claimable_import`, 20260828120000/20260828140000) and C3
 * (`claim_event_import`, 20260828130000).
 *
 * OUTSIDE `(app)`, LIKE `/card/[code]` AND `/c/[token]`, AND FOR THE SAME
 * REASON
 *
 * The `(app)` layout redirects every signed-out visitor to `/`, which would
 * lose the token entirely — exactly the failure `/card/[code]`'s own header
 * describes for a lost NFC tap. This route keeps its own self-contained gate
 * so a visitor who signs in from here lands right back on this URL
 * (`ClaimSignIn`'s `postLoginRedirectURL`), never on a generic home screen
 * that has forgotten which guest-list link they clicked.
 *
 * FOUR SCREENS, ONE ROUTE, AND WHY THE SPLIT IS BY DISCLOSURE LEVEL, NOT BY
 * STEP NUMBER
 *
 * §4.2 lists five steps (email, unverified claim page, verify, review
 * prefill, land on event) as if they were separate screens. They collapse to
 * four components rendered from ONE page load because what actually decides
 * what to draw is not "which step" but "what is this caller currently
 * allowed to know" — the same two-disclosure-level split
 * `get_claimable_import`'s own migration documents:
 *
 *   1. Not signed in at all -> `ClaimSignIn`. Nothing about the token has
 *      been read yet — `get_claimable_import` requires `authenticated` and
 *      grants nothing to `anon` (20260828120000's header explains why: a
 *      per-caller rate limit needs a caller).
 *   2. Signed in, `available: false` -> `ClaimNotAvailable`. Bad token,
 *      expired, already claimed, or rate-limited — indistinguishable by
 *      design (§3.6), so this component takes no reason and renders one
 *      thing for all of them. This is ALSO what a caller sees if their own
 *      per-user or per-import rate limit trips, or if the RPC's own
 *      `app_config` read fails and it raises rather than answering — see
 *      `claim-service.ts` for why `getClaimableImport` never lets that
 *      surface as anything but this same shape.
 *   3. Signed in, `available: true`, `can_claim: false` -> `ClaimTeaser`.
 *      Event and host name only — the caller already knew that much from
 *      possessing the token (§11.1.4) — with a generic "not available on
 *      this account" explanation that names no specific reason (wrong email,
 *      unverified, already claimed by someone else).
 *   4. Signed in, `available: true`, `can_claim: true` -> `ClaimReview`. The
 *      prefill, checkbox-by-checkbox, and the submit that calls
 *      `claim_event_import`.
 *
 * NOTHING HERE IS A SECURITY BOUNDARY. Every one of `getClaimableImport`'s
 * fields, and the `claim_event_import` call the review screen posts to, are
 * re-derived from the caller's own session inside the database functions
 * themselves. This page decides only what to DRAW, matching the exact
 * posture `events/[eventId]/import/page.tsx` already documents for its own
 * three gates.
 */
export const dynamic = "force-dynamic";

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const context = await getAuthenticatedContext();
  if (context === null) {
    return <ClaimSignIn token={token} />;
  }

  const claimable = await getClaimableImport(context.supabase, token);

  if (!claimable.available) {
    return <ClaimNotAvailable />;
  }

  if (!claimable.can_claim || claimable.prefill === null) {
    return (
      <ClaimTeaser
        eventName={claimable.event_name}
        hostFirstName={claimable.host_first_name}
        hostLastName={claimable.host_last_name}
      />
    );
  }

  return (
    <ClaimReview
      lookupToken={token}
      eventId={claimable.event_id}
      eventName={claimable.event_name}
      hostFirstName={claimable.host_first_name}
      hostLastName={claimable.host_last_name}
      prefill={claimable.prefill}
    />
  );
}
