-- =============================================================================
-- 20260903130000_email_send_batch_size_hobby_correction.sql
--
-- WHAT THIS CHANGES
--   Corrects `email_send_batch_size` from 50 to 15, and seeds a new
--   `email_send_concurrency` (5). Both are `app_config` data changes only —
--   no schema, no function, no grant in this migration.
--
-- WHY THE ORIGINAL 50 WAS WRONG, FOUND WIRING THE CRON ROUTE, NOT ASSUMED
-- BEFOREHAND
--   20260903120000's own comment on `email_send_batch_size` reasoned about
--   Resend's rate limit (10 req/sec team-wide) and picked 50 as "well under"
--   it. That reasoning silently assumed the batch would be sent sequentially
--   within whatever time a cron function is allowed to run, and never checked
--   what that allowance actually is for this project. It is 10 seconds: this
--   project's Vercel team (confirmed via `list_teams` while building
--   `/api/cron/send-claim-emails`) is on the Hobby plan, which caps every
--   function's `maxDuration` at 10 seconds and cron frequency at once per
--   day, regardless of any `maxDuration` the route declares.
--
--   `pending-claim-emails.ts` was changed in the same commit as this
--   migration to send in concurrent chunks (`Promise.all`) rather than one
--   row at a time — see that file's own header. `email_send_concurrency`
--   (new here) is that chunk size: high enough that a real batch's I/O-bound
--   work (a suppression-check read, a Resend call, a write-back — three
--   round trips per row) fits inside 10 seconds, low enough to stay clear of
--   Resend's rate limit even with those extra Supabase calls layered on top.
--   15 rows at 5-way concurrency is 3 sequential chunks; the batch size and
--   the concurrency are both tunable here, without a deploy, once real
--   latency or a plan change is observed.
--
-- WHAT THIS MEANS FOR THE PRODUCT, STATED PLAINLY RATHER THAN LEFT IMPLICIT
--   At most 15 automatic sends per day, once per day, on the current Vercel
--   plan. §2.3.1 of the import design calls a real guest list "hundreds" —
--   at 15/day, a 200-person list takes roughly two weeks to fully email on
--   its own. The route remains manually callable (with CRON_SECRET) at any
--   time, so a host who wants faster delivery right after an import can be
--   given that as a manual trigger while this stays the automatic
--   safety-net — or the Vercel team can move to a paid plan, which raises
--   both the 10-second ceiling and the once-a-day cron limit together. Both
--   are options for the owner to choose, not a decision this migration makes
--   for them.
-- =============================================================================

update public.app_config
   set value = '15'::jsonb,
       description = 'How many pending claim-invite rows one cron run of /api/cron/send-claim-emails claims and attempts, sent in concurrent chunks of email_send_concurrency. Corrected from an initial 50 (20260903120000) after confirming via Vercel''s list_teams that this project''s team is on the Hobby plan, which caps a function at 10 seconds regardless of concurrency. Raise once the plan changes or real send volume is known.'
 where key = 'email_send_batch_size';

insert into public.app_config (key, value, description) values
  ('email_send_concurrency', '5'::jsonb,
   'How many claim-invite sends run concurrently (Promise.all) within one chunk of a cron run, rather than sequentially. I/O-bound work (a suppression check, a Resend call, a write-back per row) benefits from concurrency directly, and it is what makes email_send_batch_size rows fit inside a 10-second Vercel Hobby function at all. Kept comfortably under Resend''s default 10 req/sec team-wide rate limit even with each row''s other Supabase calls layered on top.')
on conflict (key) do nothing;
