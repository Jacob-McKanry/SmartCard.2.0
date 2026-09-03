-- =============================================================================
-- 20260902140000_event_attendee_imports_email_send_state.sql
--
-- WHAT THIS CHANGES
--   Adds `emailed_at` and `email_error` to `public.event_attendee_imports`,
--   and re-points `public.claim_event_import` at the widened destruction list
--   below. Phase 2 of `docs/architecture/2026-09-02-event-invite-email.md` —
--   Phase 1 (20260902130000) built the do-not-mail list this table's future
--   send job (Phase 3) has to check; this is the two columns that same job
--   writes back to say what happened for each row.
--
-- WHAT THE TWO COLUMNS MEAN, AND WHAT THEY DO NOT
--   `emailed_at` — when the send job successfully handed this row's email to
--     Resend. NOT a delivery or open confirmation; §3.9 of the import design
--     already refuses to expose per-person delivery detail to a host beyond
--     aggregates, and this column does not change that — it is written by
--     system code, never read back through any client-facing surface this
--     migration adds.
--   `email_error` — the last SEND attempt's own failure (Resend rejected the
--     request: a malformed address, an API error). Deliberately NOT how a
--     bounce or complaint is recorded — those happen after Resend already
--     accepted the message and are the webhook's job
--     (`/api/webhooks/resend`), writing to `email_suppressions` instead, a
--     table with no per-row per-import trace back to here on purpose (that
--     table's own header: suppression is a fact about an address, not about
--     one host's one import).
--
-- WHY BOTH ARE ADDED TO claim_event_import's DESTRUCTION LIST, NOT LEFT ALONE
--   §2.2 of the 2026-08-22 import design nulls every column that is either
--   personal data or could leak it once a row is claimed, keeping only the
--   attendance fact. `email_error` can echo the recipient's own address back
--   inside a provider's error text ("recipient@x.com is not a valid
--   address"), which makes it exactly the kind of column §2.2 already
--   destroys elsewhere on this table — not a new argument, the existing one
--   applied to a new column. `emailed_at` is not personal data on its own,
--   but nulling it alongside its sibling keeps the destruction list one
--   simple rule ("nothing about the import survives claim but the fact and
--   its timestamp") rather than a column-by-column judgment call that a
--   future column addition would have to re-derive from scratch.
--
--   The claim function's UPDATE is otherwise byte-identical to
--   20260828130000's — the two new columns are added to the same SET list,
--   nothing else in the function changed.
--
-- WHAT AN IMPORT UPSERT DOES TO THESE COLUMNS: NOTHING, DELIBERATELY
--   `import_event_attendees`'s `on conflict (event_id, email) do update` (
--   20260827130000) is UNCHANGED by this migration and does not mention
--   either new column, so a re-upload of a corrected CSV neither clears nor
--   re-triggers a send for a row that was already emailed. The alternative —
--   resetting `emailed_at` on every re-upload — would mean a host fixing one
--   typo in a 500-row file re-mails 499 people who already got their link,
--   which is the opposite of what "correct rather than duplicate" (that
--   migration's own phrase for the upsert) is supposed to mean.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   No RLS or grant change: `event_attendee_imports` keeps the zero-policy,
--   zero-grant posture 20260827130000 established, and these two columns are
--   exactly as unreadable through any client role as every other column on
--   this table. Nothing here adds a way to read them — the send job (Phase 3)
--   writes them with the service role, the same tool already justified for
--   this table's other system-only writers.
--
-- VERIFIED LIVE in a rolled-back transaction before applying: both new
--   columns persist a written value; claiming a row nulls both alongside the
--   rest of the destruction list, confirmed by re-reading the row after.
-- =============================================================================

alter table public.event_attendee_imports
  add column emailed_at timestamptz,
  add column email_error text;

comment on column public.event_attendee_imports.emailed_at is
  'When the send job successfully handed this row''s email to Resend. Not a '
  'delivery or open confirmation. Nulled on claim along with the rest of '
  'this table''s destruction list (§2.2) — see this migration''s header.';

comment on column public.event_attendee_imports.email_error is
  'The last SEND ATTEMPT''s own failure (Resend rejected the request), never '
  'a bounce or complaint — those land in email_suppressions via the webhook '
  'instead. Can echo the recipient''s own address back inside a provider '
  'error, so it is nulled on claim like the rest of this table''s PII.';

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
  -- 20260828130000's header for why this cannot be two. emailed_at and
  -- email_error are new to this SET list (20260902140000); everything else
  -- here is unchanged.
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
         email_error = null
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
  'row''s PII (including emailed_at/email_error, 20260902140000) in the same '
  'statement as recording the claim. Re-derives the full §3.2/§3.2.1 gate '
  'itself via private.import_claim_authorized; does not trust that the '
  'caller ever called get_claimable_import first. Returns {claimed: boolean} '
  'and nothing else — no reason, matching CardClaimResult '
  '(card-claim-service.ts) for the same §3.6 reason.';
