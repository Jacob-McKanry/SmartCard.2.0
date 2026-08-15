-- =============================================================================
-- 20260815140000_flip_location_sharing_default_to_on.sql
--
-- WHAT THIS CHANGES
--   Two column defaults, nothing else:
--
--     meetings.location_visibility        'participants_only'  ->  'mutuals'
--     meeting_participants.location_share_consent   false      ->  true
--
--   No table changes, no RLS changes, no grant changes, no function body
--   changes. `public.create_verified_connection()` (20260813210300) inserts
--   both rows without naming these columns — it has always relied on whatever
--   the column DEFAULT is at insert time — so this migration is sufficient on
--   its own to change what a brand-new meeting starts as.
--
-- WHY THIS IS A REVERSAL, AND WHY IT IS RECORDED HERE RATHER THAN SILENTLY
--   §2.4 specified the opposite default deliberately: "consent defaults to
--   false... sharing a meeting's location with mutuals is an affirmative act by
--   every participant afterwards, and nothing here may pre-consent on their
--   behalf." `20260813210300`'s own inline comment repeats the same reasoning
--   at the insert site. That reasoning is not wrong — it is simply not what the
--   project owner wants for this product: the decision, made 2026-08-15, is
--   that a verified in-person meeting should show up in both people's feeds
--   and their mutuals' feeds BY DEFAULT, and each person individually retains
--   the power to opt out, rather than each person individually having to
--   opt in before anything is shared.
--
--   Per CLAUDE.md's rule that no decision silently diverges from the signed-off
--   architecture, this is recorded here and as an amendment to §2.4 in
--   `docs/architecture/2026-08-09-initial-architecture-proposal.md`, not left
--   as an unexplained diff. `20260813210300`'s own file is NOT edited — its
--   inline comment describing the old default is left as an accurate record of
--   what that migration did at the time it ran; this migration is what changed
--   it, and is the file to read for the current behaviour.
--
-- WHAT DOES NOT CHANGE — AND THIS IS THE PART THAT MATTERS MOST
--   Every existing privacy control keeps working exactly as before, unchanged
--   in code or policy, because none of it depends on which value is the
--   default — it depends on which value is CURRENT:
--
--     * Either participant can still unilaterally hide a meeting via
--       `marked_private`, or unilaterally revoke their own
--       `location_share_consent`, at any time, forever. Sharing now starts
--       "on"; turning it off is still a one-person action, never a two-person
--       negotiation. This is a deliberate design constraint carried over
--       unchanged — see the second decision in this pass, recorded in the
--       accompanying pull request, and it matches the existing one-sided
--       `marked_private` veto this schema already had before today.
--     * `is_private` (whole-meeting override) still works exactly as before.
--     * §3.2's four-condition RLS policy on `meeting_locations` is completely
--       untouched — `location_visibility = 'mutuals'`, `is_private = false`,
--       unanimous `location_share_consent`, and the viewer being a mutual of
--       both parties are still all required. What changed is which of those
--       four conditions is TRUE on day one of a new meeting, not what the
--       policy checks.
--     * The application code needed NO changes. `deriveLocationSharingStatus`
--       (`apps/web/src/app/(app)/connections/[connectionId]/location-sharing.ts`)
--       is a pure function of whatever state the database hands it — it does
--       not assume which state is the starting one, and every state it can
--       produce (`not-offered`, `waiting-on-you`, `waiting-on-them`, `shared`,
--       `blocked-by-privacy`) remains reachable: `not-offered` now requires a
--       participant to have actively turned `location_visibility` back to
--       `participants_only`, which the existing column grant already permits.
--
-- WHY THIS MIGRATION DOES NOT TOUCH ANY EXISTING ROW
--   Deliberately not backfilled. There is exactly one meeting in production as
--   of this migration, and its participants' consent is currently unset —
--   i.e., the state §2.4 describes as "nobody has proposed sharing yet."
--   Retroactively flipping that row's consent to `true` would grant sharing on
--   a real person's behalf without their action, which is precisely what §2.4's
--   original "nothing here may pre-consent on their behalf" rule exists to
--   forbid — applying it in the opposite direction. The new default governs
--   meetings created from this point forward only; nothing already recorded
--   changes visibility as a side effect of this migration.
--
-- ACCESS GRANTED / FORBIDDEN
--   Unchanged. `authenticated` already held `update (location_visibility)` on
--   `meetings` and `update (location_share_consent, marked_private)` on
--   `meeting_participants` (20260809211200) before this migration, and holds
--   exactly the same after it. This migration changes what a new row starts
--   as, not who may write to it.
-- =============================================================================

alter table public.meetings
  alter column location_visibility set default 'mutuals';

alter table public.meeting_participants
  alter column location_share_consent set default true;

comment on column public.meetings.location_visibility is
  'participants_only / mutuals. Defaults to ''mutuals'' as of 20260815140000 — '
  'a verified meeting is shared with mutuals by default, and either participant '
  'may turn it back to participants_only via the existing column-level UPDATE '
  'grant (20260809211200). Before this migration the default was '
  '''participants_only''; see this migration''s header and the §2.4 amendment '
  'in the architecture doc for why it changed and what did not.';

comment on column public.meeting_participants.location_share_consent is
  'Defaults to true as of 20260815140000 — sharing starts on, and each '
  'participant individually opts OUT rather than opts in. Either participant '
  'may set their own row to false at any time via the existing column-level '
  'UPDATE grant (20260809211200); this remains a one-person action, never '
  'requiring the other participant to agree. Before this migration the '
  'default was false. See this migration''s header for the full reasoning.';