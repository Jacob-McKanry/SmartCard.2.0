-- =============================================================================
-- 20260909120000_event_attendee_imports_cascade_on_claimant_delete.sql
--
-- WHAT THIS CHANGES
--   `event_attendee_imports.claimed_by_user_id`'s foreign key to `users(id)`
--   changes from `ON DELETE SET NULL` to `ON DELETE CASCADE`.
--
-- THE BUG THIS FIXES, FOUND BY HITTING IT LIVE
--   `event_attendee_imports_claim_is_complete` (20260827130000) requires
--   `claimed_by_user_id` and `claimed_at` to be BOTH null or BOTH set — never
--   one without the other. `ON DELETE SET NULL` only ever nulls the one
--   column named in the FK; it has no way to also null `claimed_at`. So
--   deleting a `public.users` row that had claimed an import — an operator
--   hard-deleting a test account, found while cleaning up guest-list-claim
--   test data — left `claimed_by_user_id = null` with `claimed_at` still set,
--   which the check constraint (correctly) refuses:
--     ERROR: 23514: new row for relation "event_attendee_imports" violates
--     check constraint "event_attendee_imports_claim_is_complete"
--   The delete failed outright; the only workaround available at the time was
--   deleting the now-orphaned import rows by hand before retrying.
--
-- WHY CASCADE IS THE RIGHT FIX HERE, NOT "ALSO NULL claimed_at"
--   The straightforward-looking alternative — a trigger that nulls both
--   columns together — was considered and rejected. Once a row is claimed,
--   `claim_event_import` (20260828130000) destroys every other column that
--   could identify the guest: email, name, phone, company, social links, and
--   the lookup token are all wiped in the same statement as the claim,
--   leaving `claimed_by_user_id` as the row's ONLY remaining payload. A row
--   with `claimed_by_user_id` nulled back out would have nothing left in it
--   at all — not the original PII (already gone), not a lookup token
--   (already gone), not a claimant. Keeping that empty shell around serves
--   no purpose an "unclaimed, reclaimable" row would (it has no token to
--   claim with), and no purpose a "claimed" row would (it names no one).
--   Deleting it loses nothing a kept-but-emptied row would have preserved.
--
--   This is a narrower case than `event_rsvps`, which soft-delete
--   deliberately leaves untouched (20260815130300's header) because an RSVP
--   status is still meaningful information even once its owner is gone, and
--   because it is the OTHER party's (the host's) history too. A claimed
--   import row has no such independent meaning left in it once the identity
--   is gone — there is no second party with a continuing interest in an
--   empty row the way a host has in "this many people are going."
--
-- WHY THIS DID NOT SURFACE UNTIL NOW
--   Every other write path in this schema goes through
--   `public.soft_delete_own_account()` (20260815130300), which never deletes
--   a `users` row at all — it flips `status` to `'deleted'` and leaves the
--   row, so this FK's `ON DELETE` action had never actually fired in
--   practice. A real `DELETE FROM public.users` is an operator-only, direct-
--   SQL operation with no in-app caller (by design — see that migration's
--   own header on why a hard delete "is a different operation... and should
--   be written as one"). This migration is that operation catching up with
--   the one column it had not been reasoned through for.
--
-- A RELATED, STILL-UNFIXED CASE — FLAGGED, NOT FIXED, DELIBERATELY
--   `pending_connections.claimed_by_user_id` (20260809210800) has the exact
--   same shape of bug: `pending_connections_claim_is_attributed` requires
--   `claimed_by_user_id` and `claimed_at` together whenever `status =
--   'claimed'`, and that FK is also `ON DELETE SET NULL`. It is NOT fixed
--   here, on purpose: that table is an explicitly deferred, unbuilt flow —
--   "no policy and no grant to any role... unreachable by any client until
--   the flow is built" (that migration's own header) — confirmed to have no
--   code path anywhere that ever sets `claimed_by_user_id` on it. Unlike
--   this table, `pending_connections` is not just an identity-plus-metadata
--   record: `initiator_user_id` is a real, separate party with an ongoing
--   interest in the row (their own record of having met someone), so the
--   right fix there is very likely NOT a straight cascade the way it is
--   here — it would need to preserve the initiator's row while resolving
--   what an orphaned claim means for `status`, which is a design decision
--   for whoever builds that flow, not a mechanical one to guess at now.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: nothing — no role gains any new access. Forbids: nothing
--   previously allowed. This only changes what happens, internally, when a
--   `public.users` row referenced by `claimed_by_user_id` is deleted: the
--   dependent `event_attendee_imports` row is now removed with it instead of
--   left behind in a state the table's own check constraint already refused
--   to allow.
--
-- VERIFIED LIVE in a rolled-back transaction before applying: created a
--   host, a claimant, an event, and an already-claimed import row (PII
--   already wiped, matching a real post-claim row exactly); deleting the
--   claimant previously raised 23514 on this exact fixture and now succeeds,
--   with zero import rows left behind for that event afterward.
-- =============================================================================

alter table public.event_attendee_imports
  drop constraint event_attendee_imports_claimed_by_user_id_fkey;

alter table public.event_attendee_imports
  add constraint event_attendee_imports_claimed_by_user_id_fkey
  foreign key (claimed_by_user_id) references public.users(id) on delete cascade;

comment on column public.event_attendee_imports.claimed_by_user_id is
  'The account that claimed this guest-list row. ON DELETE CASCADE (changed '
  'from SET NULL, 20260909120000): once claimed, this column is the row''s '
  'only remaining identifying content — claim_event_import destroys every '
  'other field in the same statement as the claim — so if the claiming '
  'account is later deleted outright, the row has nothing left to say and is '
  'removed with it rather than kept as an empty, unclaimable shell that the '
  'event_attendee_imports_claim_is_complete check constraint would refuse '
  'anyway (claimed_at without a claimant).';
