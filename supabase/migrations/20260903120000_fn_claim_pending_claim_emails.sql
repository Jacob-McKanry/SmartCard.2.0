-- =============================================================================
-- 20260903120000_fn_claim_pending_claim_emails.sql
--
-- WHAT THIS CHANGES
--   Adds `email_send_claimed_at` to `event_attendee_imports`, and
--   `public.claim_pending_claim_emails(integer)` — the atomic batch claim the
--   Phase 4 cron route (`/api/cron/send-claim-emails`) uses to pick up pending
--   rows without two overlapping runs ever sending the same guest their email
--   twice. Widens `claim_event_import`'s destruction list to null the new
--   column, and seeds `email_send_batch_size` in `app_config`.
--
-- WHY THIS EXISTS
--   Phase 3 (`send-claim-email.ts`) built the unit that sends one email for
--   one row. Nothing calls it yet — see
--   `docs/architecture/2026-09-02-event-invite-email.md` §4.2 for why the
--   trigger was deliberately deferred to this phase rather than wired
--   directly into `importEventAttendees`. This migration is the database side
--   of that trigger: a safe way to hand a batch of rows to the cron route.
--
-- ===========================================================================
-- WHY A CLAIM STEP EXISTS AT ALL, RATHER THAN THE ROUTE JUST SELECTING ROWS
-- ===========================================================================
--   Vercel does not guarantee a cron job's previous invocation has finished
--   before the next one starts, and this codebase's own precedent
--   (`claim_event_import`'s `claimed_by_user_id is null` guard,
--   `cancel_event`'s `status = 'scheduled'` guard) is to let the database
--   decide who gets a row rather than whichever request read it first. A
--   plain `SELECT ... WHERE emailed_at IS NULL` read by two overlapping runs
--   would both see the same pending rows and both try to send them — the
--   guest gets the identical email twice, and both runs race on the same
--   write-back afterward. `FOR UPDATE SKIP LOCKED` inside a CTE, feeding an
--   `UPDATE ... RETURNING`, is the standard Postgres pattern for exactly this:
--   the SECOND concurrent call to this function sees the first call's
--   candidate rows as locked and picks different ones instead, re-evaluating
--   its own LIMIT against whatever remains unlocked. This is well-established
--   Postgres behaviour, not re-derived or independently proven here — the
--   verification below checks this migration's own SQL is correct, not that
--   `FOR UPDATE SKIP LOCKED` itself works.
--
-- ===========================================================================
-- WHY A SEPARATE COLUMN (email_send_claimed_at) RATHER THAN REUSING
-- email_error AS A "sending" SENTINEL
-- ===========================================================================
--   A sentinel string in `email_error` would conflate two different facts —
--   "this row is currently being attempted" and "this row's last attempt
--   failed, with this message" — in one column, which is exactly the kind of
--   ambiguity a future reader (or a future migration) could get backwards. A
--   dedicated timestamp says only what it means: when this row was last
--   claimed for sending. It is not personal data on its own and carries no
--   recipient detail, but is nulled on claim anyway (see below) to keep the
--   destruction list one simple rule rather than a column-by-column judgment
--   call — the same reasoning 20260902140000 already gives for nulling
--   `emailed_at` alongside `email_error`.
--
-- ===========================================================================
-- WHY A CLAIM CAN BE RECLAIMED AFTER 10 MINUTES
-- ===========================================================================
--   A row claimed by a cron run that then crashed, timed out, or was killed
--   mid-batch would otherwise sit with a stale `email_send_claimed_at`
--   forever — `email_error IS NULL` still holds (the send was never actually
--   attempted), but nothing would ever pick the row up again. Ten minutes is
--   generous against a single cron run's real work (at most
--   `email_send_batch_size` sequential Resend calls) while still bounding how
--   long a genuinely stuck row waits before a later run tries again. A row
--   whose send attempt genuinely failed is NOT covered by this — see the
--   `email_error IS NULL` clause, which stops a real failure from being
--   retried by this mechanism at all (retry-on-failure is not something this
--   phase promises; Phase 2's own comment already calls `email_error` "the
--   LAST send attempt's own failure," singular).
--
-- ===========================================================================
-- WHY `security invoker`, NOT `security definer`, MATCHING rate_limit_consume
-- ===========================================================================
--   The identical reasoning `rate_limit_consume`'s own header already gives
--   (20260813210200): the only caller is the service role, which already
--   bypasses RLS. Making this `definer` would create a function that writes a
--   security-relevant table with the owner's rights, so a future mis-grant
--   would be immediately exploitable. As `invoker`, a mis-granted EXECUTE
--   still lands on a role with no privilege on the table and the update
--   simply fails — two locks instead of one.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: EXECUTE on `claim_pending_claim_emails` to `service_role` only —
--     `authenticated` and `anon` are explicitly revoked, matching
--     `rate_limit_consume`'s own precedent that Postgres grants EXECUTE to
--     PUBLIC by default and PUBLIC includes both.
--   Forbids: no client role (including a signed-in host) can call this
--     function or otherwise claim a row for sending. Nothing about
--     `event_attendee_imports`'s existing zero-policy, zero-grant posture
--     changes.
--
-- VERIFIED LIVE in a rolled-back transaction before applying: `authenticated`
--   and `anon` are both refused execution outright; claiming 2 of 3 pending
--   rows returns the two OLDEST by `imported_at` and stamps
--   `email_send_claimed_at` on exactly those two; an immediate second claim
--   call does not re-claim the freshly-leased rows and instead returns the
--   one row left; a third call with nothing pending returns zero rows; a row
--   whose lease is manually backdated past 10 minutes becomes reclaimable
--   again; a row carrying a real `email_error` is never reclaimed regardless
--   of its lease state; `claim_event_import`'s own definition was confirmed
--   to null `email_send_claimed_at` in its destruction UPDATE.
-- =============================================================================

alter table public.event_attendee_imports
  add column email_send_claimed_at timestamptz;

comment on column public.event_attendee_imports.email_send_claimed_at is
  'When a cron run last claimed this row to attempt a send (Phase 4). Not '
  'personal data, but nulled on claim alongside the rest of this table''s '
  'destruction list — see 20260903120000''s header. A lease older than 10 '
  'minutes with email_error still null is reclaimable by '
  'claim_pending_claim_emails, covering a cron run that died mid-batch.';

-- ---------------------------------------------------------------------------
-- claim_pending_claim_emails
-- ---------------------------------------------------------------------------
create or replace function public.claim_pending_claim_emails(p_limit integer)
returns setof public.event_attendee_imports
language sql
volatile
security invoker
set search_path = ''
as $$
  with candidates as (
    select id from public.event_attendee_imports
     where claimed_by_user_id is null
       and emailed_at is null
       and email_error is null
       and (email_send_claimed_at is null or email_send_claimed_at < now() - interval '10 minutes')
       and expires_at > now()
     order by imported_at asc
     limit least(greatest(p_limit, 1), 500)
     for update skip locked
  )
  update public.event_attendee_imports e
     set email_send_claimed_at = now()
    from candidates c
   where e.id = c.id
  returning e.*;
$$;

comment on function public.claim_pending_claim_emails(integer) is
  'Atomically claims up to p_limit (clamped 1-500) pending claim-invite rows, '
  'oldest imported_at first, via FOR UPDATE SKIP LOCKED so two overlapping '
  'cron runs never claim the same row. service_role only — see this '
  'migration''s header for why security invoker rather than definer.';

revoke all on function public.claim_pending_claim_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_pending_claim_emails(integer) to service_role;

-- ---------------------------------------------------------------------------
-- claim_event_import: widen the destruction list — see the header
-- ---------------------------------------------------------------------------
create or replace function public.claim_event_import(p_lookup_token text, p_approved_fields jsonb)
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
  v_updated integer;
  v_keep_first_name boolean;
  v_keep_last_name boolean;
  v_keep_phone_number boolean;
  v_keep_company_name boolean;
  v_keep_company_role boolean;
  v_keep_social_links boolean;
  v_link jsonb;
begin
  if v_user is null then
    return jsonb_build_object('claimed', false);
  end if;

  select (value #>> '{}')::integer into v_per_user_limit
    from public.app_config where key = 'rate_limit_event_claim_per_user_hour';
  select (value #>> '{}')::integer into v_per_import_limit
    from public.app_config where key = 'rate_limit_event_claim_per_import_hour';

  if v_per_user_limit is null or v_per_import_limit is null then
    return jsonb_build_object('claimed', false);
  end if;

  if not public.rate_limit_consume(
       'event_claim', 'user', v_user::text, v_per_user_limit, 3600) then
    return jsonb_build_object('claimed', false);
  end if;

  select * into v_row
    from public.event_attendee_imports
   where lookup_token = p_lookup_token;

  if v_row.id is null then
    return jsonb_build_object('claimed', false);
  end if;

  if not public.rate_limit_consume(
       'event_claim', 'import', v_row.id::text, v_per_import_limit, 3600) then
    return jsonb_build_object('claimed', false);
  end if;

  if v_row.claimed_at is not null or v_row.expires_at <= now() then
    return jsonb_build_object('claimed', false);
  end if;

  if not private.import_claim_authorized(v_row) then
    return jsonb_build_object('claimed', false);
  end if;

  v_keep_first_name   := coalesce((p_approved_fields ->> 'first_name')::boolean, false);
  v_keep_last_name    := coalesce((p_approved_fields ->> 'last_name')::boolean, false);
  v_keep_phone_number := coalesce((p_approved_fields ->> 'phone_number')::boolean, false);
  v_keep_company_name := coalesce((p_approved_fields ->> 'company_name')::boolean, false);
  v_keep_company_role := coalesce((p_approved_fields ->> 'company_role')::boolean, false);
  v_keep_social_links := coalesce((p_approved_fields ->> 'social_links')::boolean, false);

  -- THE ATOMIC CLAIM AND THE §2.2 DESTRUCTION, ONE STATEMENT — see
  -- 20260828130000's header. email_send_claimed_at is new to this SET list
  -- (20260903120000), joining emailed_at/email_error (20260902140000);
  -- everything else here is unchanged.
  update public.event_attendee_imports
     set claimed_by_user_id = v_user,
         claimed_at = now(),
         email = null,
         first_name = null,
         last_name = null,
         phone_number = null,
         company_name = null,
         company_role = null,
         social_links = '[]'::jsonb,
         lookup_token = null,
         emailed_at = null,
         email_error = null,
         email_send_claimed_at = null
   where id = v_row.id
     and claimed_by_user_id is null
     and expires_at > now();

  get diagnostics v_updated = row_count;

  if v_updated <> 1 then
    return jsonb_build_object('claimed', false);
  end if;

  update public.users
     set first_name   = case when v_keep_first_name   then coalesce(first_name,   v_row.first_name)   else first_name   end,
         last_name    = case when v_keep_last_name    then coalesce(last_name,    v_row.last_name)    else last_name    end,
         phone_number = case when v_keep_phone_number then coalesce(phone_number, v_row.phone_number) else phone_number end,
         company_name = case when v_keep_company_name then coalesce(company_name, v_row.company_name) else company_name end,
         company_role = case when v_keep_company_role then coalesce(company_role, v_row.company_role) else company_role end
   where id = v_user;

  if v_keep_social_links then
    for v_link in select * from jsonb_array_elements(coalesce(v_row.social_links, '[]'::jsonb))
    loop
      insert into public.social_links (user_id, platform, url)
      select v_user, v_link ->> 'platform', v_link ->> 'url'
      where v_link ->> 'platform' is not null
        and v_link ->> 'url' is not null
        and not exists (
          select 1 from public.social_links
           where user_id = v_user and platform = v_link ->> 'platform'
        );
    end loop;
  end if;

  return jsonb_build_object('claimed', true);
end;
$$;

comment on function public.claim_event_import(text, jsonb) is
  'Claims an import row (§2.2/§3.8 of the 2026-08-22 attendee-import design): '
  'copies the fields named true in p_approved_fields into the caller''s own '
  'profile — filling blanks only, never overwriting — then destroys the '
  'row''s PII (including emailed_at/email_error/email_send_claimed_at, '
  '20260902140000/20260903120000) in the same statement as recording the '
  'claim. Re-derives the full §3.2/§3.2.1 gate itself via '
  'private.import_claim_authorized; does not trust that the caller ever '
  'called get_claimable_import first. Returns {claimed: boolean} and nothing '
  'else — no reason, matching CardClaimResult (card-claim-service.ts) for '
  'the same §3.6 reason.';

-- ---------------------------------------------------------------------------
-- Batch size, seeded rather than hardcoded — same argument as every other
-- app_config row this project has added.
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value, description) values
  ('email_send_batch_size', '50'::jsonb,
   'How many pending claim-invite rows one cron run of /api/cron/send-claim-emails claims and attempts. Kept well under Resend''s default 10 req/sec team-wide rate limit even at a fast sequential pace, and bounds one run''s wall-clock time. Raise once a real send volume and the Vercel plan''s cron frequency are both known.')
on conflict (key) do nothing;
