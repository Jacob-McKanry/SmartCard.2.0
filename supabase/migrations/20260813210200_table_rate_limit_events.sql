-- =============================================================================
-- 20260813210200_table_rate_limit_events.sql
--
-- WHAT THIS CHANGES
--   Creates `public.rate_limit_events` — one generic append-only table that all
--   of §4.6's limits are counted from — plus two service-role-only functions:
--     public.rate_limit_consume(action, subject_kind, subject_key, limit, window)
--     public.rate_limit_prune(older_than_seconds)
--
-- WHY POSTGRES AND NOT REDIS
--   Q11, resolved 2026-08-09: a Postgres table. Zero extra service and zero
--   extra cost at pilot scale, and the check is a small, swappable piece if
--   Upstash is ever needed. This migration is that decision made concrete.
--
-- WHY ONE GENERIC TABLE AND NOT A COLUMN PER LIMIT
--   §4.6 lists seven limits over four different subjects (a user, an IP, a
--   card, a session) across three endpoints, and more will follow (contacts
--   import is already on the list, and is not built). A table per limit, or a
--   counter column bolted onto `users` and `cards`, would mean a schema change
--   every time a limit is added and would scatter the same logic across several
--   shapes. `(action, subject_kind, subject_key)` covers every case in §4.6 and
--   every case likely to follow, with one index and one function to review.
--
--   The cost of the generic shape is that `subject_key` is untyped text and
--   carries no foreign key. That is deliberate: the subject is sometimes a user
--   id, sometimes a card id, and sometimes a hashed IP that references nothing
--   at all. A FK would work for two of those and be impossible for the third.
--
-- WHY THE THRESHOLDS ARE NOT IN THIS TABLE
--   They are `app_config` rows (20260813210000), for the same reason every
--   other threshold in the verification path is: a limit that turns out to be
--   wrong at 8pm on the night of the pilot must be changeable in seconds
--   without a deploy (§4.3). This table holds only the events being counted.
--
-- WHY IPs ARE STORED HASHED, NEVER RAW
--   Matching `connection_attempts.ip_hash`. An IP address is personal data as
--   well as a rate-limiting signal, and only the second use needs the value to
--   be comparable-to-itself — which a hash preserves. Callers pass the hash;
--   this table never sees a raw address.
--
-- ACCESS GRANTED / FORBIDDEN
--   Nothing is granted to anyone. RLS is enabled and forced with ZERO policies,
--   and `anon`/`authenticated` hold no privilege on the table or on either
--   function. This is the same posture as `connection_attempts` and
--   `app_config` (§3.5), and for the same reason one level up: a client that
--   could read this table would learn exactly how much budget it has left, and
--   a client that could write it could either exhaust someone else's budget or
--   erase its own. Only the service role — i.e. the connect endpoints
--   themselves — touches any of it.
-- =============================================================================

create table public.rate_limit_events (
  id bigint generated always as identity primary key,

  -- Which limit this event counts against, e.g. 'qr_session_create',
  -- 'qr_redeem', 'nfc_redeem', 'connect_endpoint'. Free text rather than a
  -- CHECK: unlike `connection_attempts.outcome`, whose value is comparability
  -- across the whole dataset, this column's only job is to keep counters
  -- separate. A new endpoint must not require a migration before it can be
  -- limited — the failure mode of that friction is an unlimited endpoint.
  action text not null,

  -- CHECKed, because unlike `action` this genuinely is a closed set: a rate
  -- limit is levied against a user, an IP, a card or a session, and a typo here
  -- would silently create a second, empty counter — i.e. would silently switch
  -- the limit off. That is the one failure mode a rate limiter must not have.
  subject_kind text not null
    check (subject_kind in ('user', 'ip', 'card', 'session')),

  -- The subject's identifier: a user id, a card id, a session id, or a hashed
  -- IP. Text and unconstrained on purpose — see the header.
  subject_key text not null,

  occurred_at timestamptz not null default now()
);

comment on table public.rate_limit_events is
  'Append-only event log the §4.6 rate limits are counted from (Q11: Postgres, '
  'not Redis). No policy and no grant to anon/authenticated — service role only, '
  'the same posture as connection_attempts and app_config (§3.5).';

comment on column public.rate_limit_events.subject_key is
  'A user id, card id, session id, or HASHED ip — never a raw IP address. '
  'Matching connection_attempts.ip_hash: an IP is personal data, and rate '
  'limiting only needs the value to be comparable to itself.';

-- The one query this table is ever asked: "how many events for this
-- (action, subject) since T?". Leading columns are the equality predicates,
-- trailing column is the range scan.
create index rate_limit_events_lookup_idx
  on public.rate_limit_events (action, subject_kind, subject_key, occurred_at desc);

-- Supports pruning, which scans by time across every action at once.
create index rate_limit_events_occurred_at_idx
  on public.rate_limit_events (occurred_at);

alter table public.rate_limit_events enable row level security;
alter table public.rate_limit_events force row level security;
revoke all on public.rate_limit_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- rate_limit_consume
-- ---------------------------------------------------------------------------
-- Records one event and reports whether the subject is still within its limit.
--
-- WHY IT RECORDS FIRST AND COUNTS AFTERWARDS, WHICH LOOKS BACKWARDS
--   The obvious implementation — count, then record if allowed — has a race:
--   two concurrent requests both count N-1, both decide they are allowed, and
--   the subject gets N+1. Closing that with a lock would serialise every
--   connect request in the system through one row.
--
--   Recording first removes the race without a lock. Both concurrent requests
--   insert, both then count, and both see at least the true total — so under
--   contention this errs toward rejecting, never toward letting an extra
--   request through. For a security limit, "occasionally one request stricter
--   than the nominal ceiling" is the correct direction to be wrong in, and it
--   is the fail-closed posture CLAUDE.md requires on this path.
--
--   The second consequence is intended too: a REJECTED attempt still consumes
--   budget. An attacker cannot get free retries by ensuring their requests fail
--   early — which matters because §4.2 step 5 evaluates rate limits LAST, so a
--   request that dies at the signature check never reaches the limit test. It
--   still spent its budget getting there.
--
-- WHY `security invoker` AND NOT `security definer`
--   Every §3.1 helper is `security definer` because a policy needs it to see
--   rows the CALLER may not. Nothing of the kind applies here: the only caller
--   is the service role, which already bypasses RLS. Making this `definer`
--   would create a function that writes a security-relevant table with the
--   owner's rights, so a future mis-grant would be immediately exploitable.
--   As `invoker`, a mis-granted EXECUTE still lands on a role with no privilege
--   on the table and the insert simply fails. Two locks instead of one.
create or replace function public.rate_limit_consume(
  p_action text,
  p_subject_kind text,
  p_subject_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count bigint;
begin
  -- Fail closed on a malformed call. A null or non-positive limit must not read
  -- as "no limit"; it reads as "this limit is misconfigured, so refuse".
  if p_action is null or p_subject_kind is null or p_subject_key is null
     or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    return false;
  end if;

  insert into public.rate_limit_events (action, subject_kind, subject_key)
  values (p_action, p_subject_kind, p_subject_key);

  select count(*)
    into v_count
  from public.rate_limit_events e
  where e.action = p_action
    and e.subject_kind = p_subject_kind
    and e.subject_key = p_subject_key
    and e.occurred_at > (now() - make_interval(secs => p_window_seconds));

  return v_count <= p_limit;
end;
$$;

comment on function public.rate_limit_consume(text, text, text, integer, integer) is
  'Records one rate-limit event and returns whether the subject is still within '
  'its limit (§4.6). Records BEFORE counting so concurrent requests err toward '
  'rejection rather than toward letting an extra one through, and so a request '
  'that fails an earlier validation step still spends its budget.';

-- ---------------------------------------------------------------------------
-- rate_limit_prune
-- ---------------------------------------------------------------------------
-- This table is append-only on the hot path, so it must be trimmed by something
-- off it. Nothing older than the longest window in `app_config` can affect any
-- decision, so anything older is pure storage cost and pure retained personal
-- data (hashed IPs and user ids describing when someone tried to connect).
-- Deleting it is both hygiene and data minimisation.
--
-- Left as a callable function rather than wired to a scheduler here: pg_cron is
-- not enabled on this project, and enabling an extension is a decision with its
-- own review, not a side effect of adding a rate limiter. Until it is
-- scheduled, the connect endpoints call it opportunistically.
create or replace function public.rate_limit_prune(p_older_than_seconds integer)
returns bigint
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  if p_older_than_seconds is null or p_older_than_seconds < 1 then
    return 0;
  end if;

  delete from public.rate_limit_events
  where occurred_at < (now() - make_interval(secs => p_older_than_seconds));

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.rate_limit_prune(integer) is
  'Deletes rate-limit events older than the given age. Anything older than the '
  'longest configured window cannot affect a decision, so retaining it is pure '
  'storage cost and pure retained personal data.';

-- Both functions are service-role-only, matching the table. Postgres grants
-- EXECUTE on new functions to PUBLIC by default, and PUBLIC includes anon and
-- authenticated — so the revoke is required, not decorative.
revoke all on function public.rate_limit_consume(text, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.rate_limit_prune(integer)
  from public, anon, authenticated;

grant execute on function public.rate_limit_consume(text, text, text, integer, integer)
  to service_role;
grant execute on function public.rate_limit_prune(integer)
  to service_role;
