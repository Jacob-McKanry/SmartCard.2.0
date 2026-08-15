-- =============================================================================
-- 20260815130000_backfill_has_completed_signup.sql
--
-- WHAT THIS CHANGES
--   One UPDATE. Every `public.users` row that exists at the moment this
--   migration runs gets `has_completed_signup = true`. No column is added, no
--   grant is changed, no policy is touched.
--
-- WHY THIS IS NEEDED AT ALL
--   `has_completed_signup` has existed since 20260809210100 and has never had a
--   writer. `ensureUser()` deliberately leaves it false ("onboarding is a thing
--   the server observes finishing, not a thing a fresh row claims") and
--   20260809211100 deliberately keeps it out of the column-level UPDATE grant
--   ("the server asserts onboarding finished, not the client claiming it did").
--   Both decisions stand and neither is changed here. The consequence, recorded
--   as an amendment beside the column in
--   `docs/architecture/2026-08-09-initial-architecture-proposal.md` §2.1, is
--   that the flag reads false on every account that has ever signed in — so the
--   moment anything gates on it, every existing member is sent through setup on
--   their next sign-in, forever, because nothing would ever write it either.
--
--   This migration and the server-side writer added alongside it
--   (`apps/web/src/server/onboarding/onboarding-service.ts`) are the two halves
--   that make the flag mean something. This half fixes the past; that half
--   handles the future.
--
-- WHY EVERY EXISTING ROW, AND NOT "EVERY ROW THAT LOOKS FINISHED"
--   The obvious-looking alternative is a conditional backfill — mark the ones
--   that already carry a name or a photo as done and send the blank ones through
--   onboarding. It was rejected, by the project owner, deliberately:
--
--     * It ambushes people mid-pilot. Somebody who signed in yesterday and did
--       not happen to fill in a last name would open the app tomorrow to a setup
--       wizard they have never seen, about an account they already have. §5.1's
--       pilot notes want a returning member's first sign-in to "feel like a
--       return rather than a signup", and this is the case that would break it.
--     * "Looks finished" is a guess, and the guess has no right answer. Every
--       field onboarding collects is optional and editable later, so a blank
--       profile is a legitimate finished state — there is no property of a row
--       that distinguishes "never asked" from "asked and skipped".
--     * The simple rule is the predictable one: onboarding is a thing that
--       happens to accounts created after this migration, and to nobody else.
--       That is one sentence to hold in your head, and it is verifiable by
--       looking at a `created_at`.
--
--   This covers the 337 migrated legacy accounts (§6.1) and every account
--   created during the build, in the same statement, because they need the same
--   answer.
--
-- WHAT THIS DOES **NOT** DO, AND WHY THAT MATTERS MORE THAN WHAT IT DOES
--   It does not grant anybody the ability to write this column. The column-level
--   UPDATE grant in 20260809211100 is untouched, so `authenticated` still cannot
--   set `has_completed_signup` — not through the API, not by talking to
--   PostgREST directly with a valid user token, not at all. After this
--   migration the column has exactly one writer in the whole system: a
--   service-role UPDATE in `assertSignupCompleted()`, called at the end of the
--   onboarding flow by server code that has itself just observed the flow
--   finish. The reasoning for choosing a service-role write over a
--   `security definer` RPC granted to `authenticated` is written at that
--   function; the short version is that an RPC callable by the client, taking no
--   evidence, IS the client claiming completion, merely spelled differently.
--
-- IDEMPOTENCE AND RE-RUNS
--   `where has_completed_signup = false` means a second run updates nothing.
--   Note the shape of the risk if this migration is ever re-run LATER than
--   intended (a rebuild from scratch against a live database, say): it would
--   also mark as complete every account created since, silently skipping their
--   onboarding. Nothing in this file can prevent that — it is recorded so that
--   whoever considers replaying migrations against production knows this one has
--   a date-dependent meaning, unlike the schema migrations around it.
-- =============================================================================

update public.users
   set has_completed_signup = true,
       updated_at = now()
 where has_completed_signup = false;

comment on column public.users.has_completed_signup is
  'Whether this account has been through the onboarding flow. Backfilled to true '
  'for every row that existed at 20260815130000, so only accounts created after '
  'that point ever see onboarding. Deliberately absent from the column-level '
  'UPDATE grant in 20260809211100: a client must not be able to claim its own '
  'onboarding finished. The single writer is a service-role UPDATE in '
  'apps/web/src/server/onboarding/onboarding-service.ts, which runs after the '
  'server has observed the flow end (including via "Skip for now" — every field '
  'is optional, so skipping is a finish, not an abandonment).';
