-- Revokes the temporary anon upload/verify-read policy opened by
-- 20260813180402_temp_photo_migration_upload_policy.sql.
--
-- Why this runs immediately, with zero files actually uploaded: outbound
-- HTTPS from this session to <project-ref>.supabase.co is blocked by the
-- organization's egress policy (confirmed via the agent proxy status
-- endpoint: `connect_rejected`, "gateway answered 403 to CONNECT", host
-- crpsbnbegeoqtlgshltt.supabase.co:443 -- not a transient failure, checked
-- twice). The Storage HTTP API is therefore unreachable from this
-- environment by any means available to this session -- there is no MCP
-- tool that performs Storage writes, and per this session's own operating
-- rules a 403 policy denial from the egress proxy is to be reported, not
-- retried or routed around (e.g. by tunnelling the upload through
-- pg_net/an Edge Function to reach the same host via a side channel --
-- that would defeat the intent of the block, not satisfy it).
--
-- Leaving the temporary policy in place while no upload can happen would
-- be pure downside: it grants the public anon key write/read access to
-- this bucket for no working benefit. Fail-closed applies here exactly as
-- it does to the connection-verification path elsewhere in this schema --
-- if the intended use of an open door cannot be completed, close the door,
-- don't leave it open "for later." The bucket itself (created by
-- 20260813180355_create_profile_photos_bucket.sql) is left in place: it
-- grants no access by existing (no policy currently references it), and
-- creating it is real, safe, completed progress toward the follow-up pass.
--
-- Net effect after this migration: `profile-photos` exists, is private,
-- and -- like every other table/bucket in this schema before its
-- corresponding feature is built -- has no client-facing read or write
-- path at all. The actual 148-file upload and the `public.users.photo_path`
-- backfill remain outstanding; see the migration-run note appended to
-- section 6.5 of docs/architecture/2026-08-09-initial-architecture-proposal.md
-- for what is needed to unblock it (network access to the Storage API, or
-- a service-role-capable upload tool).
drop policy if exists "TEMP -- legacy photo migration upload (anon, profile-photos only)"
  on storage.objects;

drop policy if exists "TEMP -- legacy photo migration verify-read (anon, profile-photos only)"
  on storage.objects;
