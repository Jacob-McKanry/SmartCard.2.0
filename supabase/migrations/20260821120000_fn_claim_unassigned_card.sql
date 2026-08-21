-- =============================================================================
-- 20260821120000_fn_claim_unassigned_card.sql
--
-- WHAT THIS CHANGES
--   Adds `public.claim_unassigned_card(text)` — the first and only way a card
--   can move from `unassigned` to `assigned` outside the 2026-08-13 legacy
--   import — plus two `app_config` rows holding its rate limits.
--
--   No table is created or altered. No RLS policy changes. No grant on
--   `public.cards` changes: the client still cannot SELECT, INSERT or UPDATE a
--   card row it does not own, and still has no lookup-by-code path of any kind.
--
-- WHY THIS EXISTS AT ALL
--   6,809 of the 7,142 imported cards are `unassigned` stock, and until now
--   nothing in the product could assign one. `status` has been written by
--   exactly one thing ever: the legacy import. A person handed a blank card had
--   no way to make it theirs — `/card/<code>` refused them as an unknown code
--   when signed out, and as "that card isn't set up yet" when signed in. The
--   physical inventory was unusable for anyone who was not already in the
--   2026-08-13 export.
--
-- ===========================================================================
-- WHY AN RPC AND NOT A POLICY, AND WHY NOT THE SERVICE ROLE EITHER
-- ===========================================================================
--   A POLICY CANNOT SERVE THIS. Claiming needs to find a card BY CODE, and
--   20260809210200 is explicit that there is no lookup-by-code path for clients
--   because `card_code` is the security-bearing secret: "a policy that let a
--   user read a card row they do not own would hand them the value needed to
--   impersonate that card in a tap". A claim policy would require exactly that
--   read. The select policy stays owner-only and this function never returns a
--   card row.
--
--   THE SERVICE ROLE WOULD HAVE WORKED AND IS THE WRONG TOOL. It would have
--   made `service-role-client.ts` take an eighth caller for an operation the
--   database can do correctly on its own, and — the deciding reason — it could
--   not have been atomic. Two people racing to claim the same blank card
--   through a read-then-write in TypeScript is a time-of-check/time-of-use bug
--   with a physical consequence: both are told they own the card, one silently
--   does not, and the card in somebody's hand points at the wrong person. A
--   single UPDATE ... WHERE status = 'unassigned' cannot have that bug.
--
--   IT FITS THE PATTERN `onboarding-service.ts` DRAWS THE LINE WITH. That file
--   rejects a `security definer` RPC for `has_completed_signup` because such an
--   RPC "would take no evidence, weigh nothing, and write `true`" — the client
--   simply asserting a fact about itself. This is the other side of that line,
--   and the same side as `decide_event_rsvp`: the caller supplies a code, and
--   the DATABASE decides whether it names a claimable card. The caller's input
--   is evidence to be weighed, not a conclusion to be recorded.
--
-- ===========================================================================
-- WHY THE RATE LIMIT IS INSIDE THIS FUNCTION AND NOT IN THE CALLING TYPESCRIPT
-- ===========================================================================
--   Because this function is granted to `authenticated`, it is reachable
--   directly over PostgREST by anyone holding a session — the app's own server
--   code is not the only caller and must not be assumed to be. A limit enforced
--   in TypeScript would be bypassed by one `rpc()` call from a browser console.
--   Every other limit in this product guards an endpoint; this one has to guard
--   the function itself, so it lives where the privilege lives.
--
--   `public.rate_limit_consume` is `security invoker` and granted only to
--   `service_role`. Inside this `security definer` function the effective role
--   is the function's owner, so the call succeeds without `authenticated` ever
--   holding EXECUTE on it — the limiter stays unreachable from a client while
--   still being usable here.
--
--   There is no per-IP budget here, because the database is not told the
--   caller's IP. That is acceptable in a way it would not be on the preview
--   path: this action requires an account, so the per-user budget is the one
--   that binds, exactly as `nfc-verifier.ts` argues for redeems ("a guesser has
--   to be a signed-in user").
--
-- ===========================================================================
-- WHAT THIS DELIBERATELY REFUSES
-- ===========================================================================
--   * A card that is `assigned` — to anybody, including the caller. Claiming is
--     not a way to take a card off its owner, and re-claiming your own is a
--     no-op the UI never needs.
--   * A card that is `revoked`. This is the sharpest of the three and the one
--     most likely to be "fixed" later by mistake. `revoked` is the owner's kill
--     switch for a card they lost (§4.5). Letting the finder of a revoked card
--     claim it would take the one control a victim has and hand it to the
--     person holding their lost property. A revoked card is dead permanently as
--     far as this function is concerned; returning it to stock is an operator
--     decision made deliberately, not something a stranger's tap can trigger.
--   * A caller with no JWT, or whose token does not resolve to a user id.
--   * A malformed or absent code, without a lookup.
--   * Anything at all when a limit is missing or unreadable — see below.
--
-- ===========================================================================
-- ONE REFUSAL, NO REASON — AND THE ONE PLACE THAT RULE IS NOW WEAKER
-- ===========================================================================
--   This function returns `{"ok": true}` or `{"ok": false}` and never says
--   which of the refusals above applied. A caller learns whether the card they
--   are holding became theirs, and nothing else — in particular a claim attempt
--   cannot distinguish "no such code" from "revoked" from "already owned by
--   somebody", which is `nfc-verifier.ts`'s rule about `card_not_found` /
--   `card_unassigned` / `card_revoked` carried onto this path unchanged.
--
--   BUT: the project owner decided on 2026-08-21 that the signed-out page at
--   `/card/<code>` WILL tell an anonymous visitor that a code names a blank,
--   claimable card, so that somebody handed a new card has a way in. That
--   splits `unassigned` out of the single refusal the preview path has always
--   returned, and it is a real reduction in what that page withholds — recorded
--   at the preview service and in §4.7 threat 1 rather than only here. It does
--   not change this function: `revoked` and "no such card" remain fused, and
--   the claim itself still discloses nothing beyond its own success.
--
-- ===========================================================================
-- THE RESIDUAL RISK, STATED AS IT ACTUALLY IS
-- ===========================================================================
--   Possession of the code is the whole of the evidence. Anyone who has SEEN a
--   blank card — a print run, a warehouse, somebody who photographs a stack on
--   a table — can claim it without ever holding it, and the person who later
--   receives that physical card cannot claim it and cannot prove they should
--   have been able to. Worse than losing the card: every tap of it thereafter
--   connects a stranger to the claimant, which is a profile-visibility grant in
--   both directions.
--
--   The project owner accepted this on 2026-08-21 with the mechanism described.
--   One argument raised in that discussion is NOT part of the justification and
--   is written down here so nobody later mistakes it for one: "they would still
--   have to sign up" is not a control. Signup is free, self-serve and
--   unlimited, so an attacker with a list of codes makes one account and claims
--   from it. What actually bounds this is that the codes exist only on the
--   physical cards, that the operator controls the stock, and that the per-user
--   budget below caps how fast a single account can work through a list.
--
--   If that ever stops being enough, the fix is not a tighter limit — it is an
--   operator "release" step gating which stock is claimable at all, which was
--   considered and deferred on 2026-08-21, not overlooked.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: EXECUTE on `claim_unassigned_card(text)` to `authenticated`, which
--     lets a signed-in caller move an UNASSIGNED card to themselves and does
--     not let them read any card row, read any other card's code, affect a card
--     that is assigned or revoked, or name the user the card goes to (it is
--     always the caller, taken from the JWT — there is no parameter for it).
--   Forbids: everything above to `anon` and `public`. No new read of
--     `public.cards` for any client role.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Limits, seeded rather than hardcoded
-- ---------------------------------------------------------------------------
-- Same argument `packages/core/src/connect/config.ts` and 20260815120000 make:
-- a threshold that needs a deploy to change is a threshold nobody changes at
-- 8pm on the night of a pilot event.
insert into public.app_config (key, value, description) values
  ('rate_limit_card_claim_per_user_hour', '5'::jsonb,
   'Max cards ONE account may attempt to claim per hour. Deliberately small: a real person claims one card, occasionally a few, and never in a hurry — while the abuse this bounds is somebody working through a list of codes photographed off a stack of blank stock. Consumed by FAILED attempts too, so probing which codes are live is not free. Raise it only for a bulk-provisioning session, and lower it again afterwards.'),

  ('rate_limit_card_claim_per_card_hour', '5'::jsonb,
   'Max claim attempts against ONE card per hour, across all accounts. Stops several accounts taking turns against the same code to get around the per-user budget, which is the obvious way to spend somebody else''s stock. Counted after the code resolves, and consumed even when the claim is then refused.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- claim_unassigned_card
-- ---------------------------------------------------------------------------
create or replace function public.claim_unassigned_card(p_card_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_card_id uuid;
  v_per_user_limit integer;
  v_per_card_limit integer;
  v_updated integer;
begin
  -- No JWT, or a request that never went through the token exchange. Fails
  -- closed like every §3.1 helper.
  if v_user is null then
    return jsonb_build_object('ok', false);
  end if;

  -- A shape filter, not a security control (the same note `cardCodeSchema`
  -- carries). Its only job is that garbage does not become a lookup.
  if p_card_code is null or p_card_code !~ '^(?:[A-Za-z0-9_-]{1,64}-)?[0-9a-fA-F]{12}$' then
    return jsonb_build_object('ok', false);
  end if;

  -- Limits are read before anything is spent, and a missing or malformed row
  -- REFUSES rather than defaulting. CLAUDE.md's fail-closed rule is explicit
  -- that a check which cannot be completed rejects the action; a claim that
  -- silently proceeds because a config row was deleted is the exact shape of
  -- the "limit switched off by accident" failure 20260813210200 exists to
  -- prevent.
  select (value #>> '{}')::integer into v_per_user_limit
    from public.app_config where key = 'rate_limit_card_claim_per_user_hour';
  select (value #>> '{}')::integer into v_per_card_limit
    from public.app_config where key = 'rate_limit_card_claim_per_card_hour';

  if v_per_user_limit is null or v_per_card_limit is null then
    return jsonb_build_object('ok', false);
  end if;

  -- Per-user budget BEFORE the lookup, mirroring `nfc-verifier.ts`: on this
  -- path the code IS the credential, so there is no cheap gate that can stand
  -- in front of the database and the budget that does not need the card is
  -- spent first.
  if not public.rate_limit_consume(
       'card_claim', 'user', v_user::text, v_per_user_limit, 3600) then
    return jsonb_build_object('ok', false);
  end if;

  -- Resolve the code. Nothing about the row is returned to the caller; the id
  -- is needed only to charge the per-card budget and to scope the UPDATE.
  select id into v_card_id
    from public.cards
   where card_code = p_card_code;

  if v_card_id is null then
    return jsonb_build_object('ok', false);
  end if;

  -- Per-card budget, which cannot be evaluated any earlier. Consumed even when
  -- the claim is then refused, so hammering one revoked or already-owned card
  -- is not free — the same property `nfc-verifier.ts` states for redeems.
  if not public.rate_limit_consume(
       'card_claim', 'card', v_card_id::text, v_per_card_limit, 3600) then
    return jsonb_build_object('ok', false);
  end if;

  -- The claim itself. `status = 'unassigned'` in the WHERE clause is what makes
  -- this safe under concurrency: two callers racing produce one UPDATE that
  -- matches a row and one that matches none, decided by the database rather
  -- than by whichever request read first. It is also what refuses `assigned`
  -- and `revoked` — they are not special-cased above precisely so there is one
  -- place the transition can happen and one condition it depends on.
  update public.cards
     set owner_user_id = v_user,
         status = 'assigned',
         assigned_at = now()
   where id = v_card_id
     and status = 'unassigned';

  get diagnostics v_updated = row_count;

  return jsonb_build_object('ok', v_updated = 1);
end;
$$;

comment on function public.claim_unassigned_card(text) is
  'Moves an UNASSIGNED card to the calling user (§2.2 stock). Takes no owner '
  'argument — the owner is the JWT''s subject, so "claimed the wrong person''s '
  'card" is not a bug this can have. Refuses assigned and revoked cards, '
  'rate-limits per user and per card from app_config, and returns only '
  '{"ok": boolean} so a claim attempt cannot be used to tell an unknown code '
  'from a revoked one.';

-- Postgres grants EXECUTE on new functions to PUBLIC, which includes anon, so
-- the revoke is required rather than decorative — same as 20260809211400.
revoke all on function public.claim_unassigned_card(text) from public, anon;
grant execute on function public.claim_unassigned_card(text) to authenticated;
