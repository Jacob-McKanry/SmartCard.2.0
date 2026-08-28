-- =============================================================================
-- 20260828120000_fn_get_claimable_import.sql
--
-- WHAT THIS CHANGES
--   Adds `public.get_claimable_import(text)` — the first read path of any kind
--   into `public.event_attendee_imports` (20260827130000) — plus two
--   `app_config` rate-limit rows and one new `private` JWT-claim helper,
--   `private.current_email_verified()`.
--
--   Widens `rate_limit_events.subject_kind`'s CHECK to add `'import'` —
--   `('user', 'ip', 'card', 'session')` becomes `('user', 'ip', 'card',
--   'session', 'import')`. No table is created, and no existing grant on any
--   pre-existing table or function changes.
--
-- WHY THE CHECK WIDENS, RATHER THAN REUSING 'user' FOR BOTH SUBJECTS
--   `subject_kind` is deliberately a closed set (20260813210200: "a rate limit
--   is levied against a user, an IP, a card or a session, and a typo here would
--   silently create a second, empty counter"). This function needs a fifth
--   kind — the resource being probed is an IMPORT ROW, not any of the four
--   that exist — and `'user'` is already spoken for by this SAME function's
--   OTHER limit, the per-caller one. Rate-limiting the row under
--   `subject_kind = 'user', subject_key = v_row.id::text` would put a row id
--   in the same counter space as a user id with no way to tell them apart,
--   which is exactly the silent-collision failure the CHECK exists to catch
--   for a typo — reusing 'user' on purpose would be that same bug, deliberate.
--   `'import'` matches the name 20260813210200's own header already
--   anticipated: "contacts import is already on the list, and is not built."
--
-- WHY THIS EXISTS
--   `docs/architecture/2026-08-22-event-attendee-import.md` §3.8/§4.2. A
--   recipient who clicks the emailed claim link has to see SOMETHING — which
--   event, whose guest list — before they can decide whether to sign in and
--   claim it. This function is that read, and it is also the one place the
--   §3.2/§3.2.1 authorization gate is evaluated for a caller who has not yet
--   written anything.
--
-- ===========================================================================
-- WHAT §4.2's "CLAIM PAGE, UNVERIFIED" ACTUALLY REQUIRES, AND THE ONE PLACE
-- THIS MIGRATION DEVIATES FROM THE DESIGN DOC'S LITERAL STEP ORDER
-- ===========================================================================
--   §4.2 lists "claim page, unverified" (step 2) BEFORE "verify — Kinde
--   signup/sign-in" (step 3), which reads as: show the event and host name to
--   somebody who is not signed in at all. This function requires `authenticated`
--   and grants nothing to `anon`. That is a deliberate departure, not an
--   oversight, for a reason specific to this schema:
--
--   §3.7 requires "per-caller and per-token limits". A per-CALLER limit needs a
--   caller — some stable identity to key `rate_limit_consume` on across
--   attempts — and an anonymous request has none available inside a `security
--   definer` SQL function. There is no client IP, no session, nothing but
--   whatever arguments the caller supplies, and a client-supplied "caller id"
--   is worthless as a rate-limit key (an attacker simply supplies a fresh one
--   every call). `card_preview_views` solves the equivalent problem for its own
--   anonymous surface by doing the read in TypeScript with the SERVICE ROLE,
--   where the real client IP is visible and can be hashed and rate-limited
--   (`card-preview-service.ts`, `request-context.ts`). That option was
--   considered and rejected here: the table's own header commits to "nobody
--   reads it directly... the only way in is a `security definer` function",
--   and reopening that for a second caller is a decision `service-role-client.ts`
--   asks to be justified, not defaulted into, for a table already described as
--   the most sensitive one in this database.
--
--   So "unverified" in §4.2 is reinterpreted as "signed in, but not yet proven
--   to be the person this row is about" rather than "not signed in at all". A
--   recipient who is not already signed in hits Kinde's ordinary sign-in/sign-up
--   screen first — which, per Q-E (confirmed 2026-08-27), already forces a
--   one-time-code email verification on that connection regardless of this
--   feature. Once ANY authenticated session exists, this function is reachable,
--   rate-limited by that session's own caller id, and the response is what
--   decides whether they see a match or a mismatch. Nothing sensitive is ever
--   shown to a request this function cannot attribute to a caller.
--
-- ===========================================================================
-- WHY "EVENT + HOST NAME" IS NOT BEHIND THE §3.2/§3.2.1 GATE, BUT THE PREFILL IS
-- ===========================================================================
--   §3.6 says refusals must be indistinguishable so this cannot become an oracle
--   for "does this email address appear on this event's guest list". That rule
--   protects a prober who does NOT already hold the token — and the token is
--   244 bits of `gen_random_uuid` output (20260827130000), unguessable regardless
--   of volume. A caller who reaches this function with a real, live, unexpired,
--   unclaimed token already possesses everything the event name and host name
--   would tell them: the host's own claim email says which event this is about
--   (§4.2 step 1, "not a SmartCard advertisement" — it names the event). Hiding
--   that behind the identity gate would not protect anybody; it would only make
--   the one legitimate use of this function — "who is this link even for?" —
--   impossible to answer before signing in.
--
--   The PREFILL is different in kind, not degree: a name, a phone number, an
--   employer, social handles belonging to a specific person who has not
--   consented to anything yet. That is exactly what §3's whole argument is
--   about, and it is gated on `can_claim` — true only when the caller's LIVE
--   token claims an email matching the row AND (that email is asserted
--   verified, OR the caller's account predates the import, per §3.2.1). A
--   caller who fails that gate for ANY reason — wrong account, unverified,
--   already claimed, expired, no such token — gets `can_claim: false` and no
--   prefill. The reasons collapse to one shape on purpose: telling a caller
--   WHICH check failed would answer the oracle question §3.6 rules out, one bit
--   at a time, across repeated sign-ins with different addresses.
--
-- WHY THE MATCH IS AGAINST `auth.email()`, NEVER `users.email`
--   Same reasoning as §3.2 and the 2026-08-27 token-claims migration:
--   `ensureUser` writes `users.email` once, on INSERT, and never updates it. An
--   account that has since changed or newly verified an address would read
--   stale here. `auth.email()` — Supabase's own builtin, the same dual-GUC
--   accessor `private.current_user_id()` already trusts `auth.uid()` to be —
--   reads the `email` claim of the CURRENT request's token, the one
--   `mintSupabaseAccessToken` signs fresh every five minutes
--   (`supabase-token.ts`). No custom accessor is added for it: Supabase already
--   provides one, proven correct by every policy in this schema that calls
--   `auth.uid()`'s sibling. `private.current_email_verified()` below exists
--   only for the one claim Supabase does NOT expose an accessor for.
--
-- WHY `users.created_at` (NOT THE LIVE TOKEN) FOR THE GRANDFATHER CHECK
--   The grandfather clause's whole premise (§3.2.1) is that an account's join
--   date is a fact about the PAST that a two-minute-old attacker account cannot
--   retroactively acquire. That is exactly the opposite of "read the live
--   token" — the live token is precisely what a fresh account CAN assert
--   truthfully today. `created_at` is read from the row itself, inside this
--   function, never accepted as an argument — a client-supplied "I've had this
--   account for years" claim would defeat the entire point, as §3.2.1 states.
--
-- ===========================================================================
-- WHY THE RATE LIMIT IS INSIDE THIS FUNCTION, MIRRORING claim_unassigned_card
-- ===========================================================================
--   Granted to `authenticated`, this function is reachable directly over
--   PostgREST by anyone holding a session, not only through the app's own
--   screens. A limit enforced in TypeScript would be bypassed by one `rpc()`
--   call from a browser console. Two limits, both consumed BEFORE the
--   information they gate is computed, so a refused or rate-limited call still
--   spends its budget and probing stays non-free (§3.7):
--
--     1. PER CALLER, first, keyed on `private.current_user_id()`. Cheapest and
--        always available — it needs no lookup — so it is checked before the
--        table is even touched.
--     2. PER IMPORT ROW (`subject_kind = 'import'`), once the token resolves
--        to one, keyed on the row's `id` rather than the raw `lookup_token` —
--        the same choice `claim_unassigned_card` makes for `card_code`, so the
--        credential string itself does not additionally end up sitting in
--        `rate_limit_events.subject_key`.
--
--   A caller who fails the per-caller limit never reaches the per-row one, and
--   both failures return the identical "not available" shape §3.6 requires.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- rate_limit_events.subject_kind: widen the closed set to add 'import'
-- ---------------------------------------------------------------------------
-- See the header for why a fifth kind is added rather than overloading 'user'.
-- Postgres has no `alter constraint`; a CHECK is dropped and re-added.
alter table public.rate_limit_events drop constraint rate_limit_events_subject_kind_check;
alter table public.rate_limit_events add constraint rate_limit_events_subject_kind_check
  check (subject_kind in ('user', 'ip', 'card', 'session', 'import'));

-- ---------------------------------------------------------------------------
-- Rate limits, seeded rather than hardcoded — same argument as every prior
-- app_config addition: a threshold that needs a deploy to change is a
-- threshold nobody changes when real abuse shows up.
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value, description) values
  ('rate_limit_claim_lookup_per_user_hour', '30'::jsonb,
   'Maximum calls to get_claimable_import ONE signed-in account may make per hour, across every token it tries. Generous enough that a person legitimately checking a guest-list link, backing out, and re-opening it (or checking links from two different events) is never the one who hits it — it exists to bound an authenticated account being used as a probe.'),

  ('rate_limit_claim_lookup_per_import_hour', '20'::jsonb,
   'Maximum calls to get_claimable_import against ONE import row per hour, regardless of who is calling. Bounds repeated hits on a single leaked or forwarded link without depending on any one account''s own budget.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- private.current_email_verified
-- ---------------------------------------------------------------------------
-- Reads `auth.jwt()` — Supabase's own builtin, which already does the dual-GUC
-- fallback `auth.uid()`/`auth.email()` use — rather than
-- `current_setting('request.jwt.claims', true)` directly. There is no
-- `auth.email_verified()` builtin to call instead, which is the one reason
-- this function exists: everything else this migration needs (`auth.uid()`,
-- `auth.email()`) Supabase already provides, proven correct by every policy
-- in this schema that already depends on the former.
create or replace function private.current_email_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'email_verified')::boolean, false);
$$;

comment on function private.current_email_verified() is
  'Whether the CALLER''s live token asserts an identity provider proved '
  'mailbox control, from the `email_verified` claim mintSupabaseAccessToken '
  'signs. False on any doubt — absent claim, malformed value — which is the '
  'fail-closed direction for the guest-list claim gate (§3.2 of the '
  '2026-08-22 attendee-import design) this exists for.';

revoke all on function private.current_email_verified() from public, anon, authenticated;
-- `security definer` functions still re-check the CALLER's own EXECUTE grant
-- when invoked from inside another function (20260809211400's finding), so
-- `get_claimable_import` below needs this grant to call it, not just to exist.
grant execute on function private.current_email_verified() to authenticated;

-- ---------------------------------------------------------------------------
-- public.get_claimable_import
-- ---------------------------------------------------------------------------
create or replace function public.get_claimable_import(p_lookup_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.current_user_id();
  v_per_user_limit integer;
  v_per_import_limit integer;
  v_row public.event_attendee_imports%rowtype;
  v_event_title text;
  v_host_first_name text;
  v_host_last_name text;
  v_host_found boolean;
  v_caller_created_at timestamptz;
  v_grandfathered boolean;
  v_email_matches boolean;
  v_can_claim boolean;
begin
  -- Belt-and-braces: PostgREST already refuses a non-`authenticated` caller at
  -- the grant, so this should be unreachable. It stays explicit because every
  -- other function that depends on a resolved caller id does the same check
  -- rather than trusting the grant alone (see decide_host_application).
  if v_user is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select (value #>> '{}')::integer into v_per_user_limit
    from public.app_config where key = 'rate_limit_claim_lookup_per_user_hour';
  select (value #>> '{}')::integer into v_per_import_limit
    from public.app_config where key = 'rate_limit_claim_lookup_per_import_hour';

  -- Fail closed (CLAUDE.md): a missing config row refuses rather than running
  -- with no limit or a null-comparison that silently never trips.
  if v_per_user_limit is null or v_per_import_limit is null then
    raise exception 'claim lookup configuration missing' using errcode = '55000';
  end if;

  -- Per-caller budget FIRST, before the table is touched at all — the
  -- cheapest check, and the one that needs no lookup to evaluate.
  if not public.rate_limit_consume(
       'claim_lookup', 'user', v_user::text, v_per_user_limit, 3600) then
    return jsonb_build_object('available', false);
  end if;

  select * into v_row
    from public.event_attendee_imports
   where lookup_token = p_lookup_token;

  -- No such token. Same shape as every other refusal below (§3.6) — this
  -- function never says which reason applied.
  if v_row.id is null then
    return jsonb_build_object('available', false);
  end if;

  -- Per-row budget, once the token resolves to one. Keyed on the row's `id`
  -- rather than `p_lookup_token` itself, matching claim_unassigned_card's
  -- choice for `card_code` — the credential string does not also end up as a
  -- rate-limit subject key.
  if not public.rate_limit_consume(
       'claim_lookup', 'import', v_row.id::text, v_per_import_limit, 3600) then
    return jsonb_build_object('available', false);
  end if;

  if v_row.claimed_at is not null or v_row.expires_at <= now() then
    return jsonb_build_object('available', false);
  end if;

  select e.title, u.first_name, u.last_name, true
    into v_event_title, v_host_first_name, v_host_last_name, v_host_found
    from public.events e
    join public.users u on u.id = e.host_user_id
   where e.id = v_row.event_id;

  -- The event (or its host) is gone. `event_id` cascades on event deletion, so
  -- this is defensive rather than expected — but a caller must never see a
  -- broken half-response, only the same "not available" everything else gets.
  if not coalesce(v_host_found, false) then
    return jsonb_build_object('available', false);
  end if;

  -- THE GATE (§3.2/§3.2.1). Email match is the lookup key and never the sole
  -- authorization on its own — it must hold together with EITHER a live
  -- verification claim or an account old enough to predate this import.
  -- `coalesce(..., false)` rather than leaning on plpgsql's tri-state boolean:
  -- a null `auth.email()` (no claim at all) must resolve to a hard `false`
  -- here, not to a `null` that then makes `v_can_claim := v_email_matches and
  -- (...)` evaluate to `null` instead of `false` when the other side is true.
  v_email_matches := coalesce(nullif(auth.email(), '')::extensions.citext = v_row.email, false);

  select u.created_at into v_caller_created_at
    from public.users u where u.id = v_user;
  v_grandfathered := coalesce(v_caller_created_at < v_row.imported_at, false);

  v_can_claim := v_email_matches
                 and (private.current_email_verified() or v_grandfathered);

  -- Event and host name: shown whenever the token itself resolves to a live,
  -- unclaimed, unexpired row, REGARDLESS of `can_claim`. See the header —
  -- possession of an unguessable 244-bit token already discloses this much,
  -- and the host's own claim email already names the event.
  return jsonb_build_object(
    'available', true,
    'event_name', v_event_title,
    'host_first_name', v_host_first_name,
    'host_last_name', v_host_last_name,
    'can_claim', v_can_claim,
    -- The prefill: null unless can_claim. NOT the row's email — the caller's
    -- own session already asserts the address that matched, so echoing it
    -- back would be redundant with something they already know about
    -- themselves rather than information this response needs to carry.
    'prefill', case when v_can_claim then jsonb_build_object(
      'first_name', v_row.first_name,
      'last_name', v_row.last_name,
      'phone_number', v_row.phone_number,
      'company_name', v_row.company_name,
      'company_role', v_row.company_role,
      'social_links', v_row.social_links
    ) else null end
  );
end;
$$;

comment on function public.get_claimable_import(text) is
  'The first read path into event_attendee_imports (§3.8 of the 2026-08-22 '
  'attendee-import design). Requires `authenticated` — see this migration''s '
  'header for why that departs from §4.2''s literal step order. Always '
  'reveals event name and host name once a token resolves to a live row '
  '(possession already discloses that much); reveals the personal prefill '
  'only when the caller''s live token proves the matching gate (§3.2/§3.2.1). '
  'Every refusal — no such token, expired, already claimed, rate-limited, or '
  'gate not satisfied for `can_claim` specifically — is indistinguishable '
  'from every other, per §3.6.';

revoke all on function public.get_claimable_import(text) from public, anon;
grant execute on function public.get_claimable_import(text) to authenticated;
