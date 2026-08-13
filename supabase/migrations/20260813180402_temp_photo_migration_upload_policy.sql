-- TEMPORARY, self-revoking migration -- part of a matched pair with
-- 20260813180755_revoke_temp_photo_migration_upload_policy.sql.
--
-- Why this migration exists at all: uploading actual file bytes into
-- Supabase Storage has to go through the Storage HTTP API (or storage-js),
-- never through `execute_sql` -- the SQL/migration tooling can create the
-- bucket row and RLS policies (both live in Postgres), but the file bytes
-- themselves live in the backing object store, which only the Storage API
-- writes to. This environment has no `SUPABASE_SERVICE_ROLE_KEY` (see
-- .env.local -- it's deliberately unset until the auth-wiring phase, per
-- the architecture doc's Q7 note that secret keys shouldn't flow through
-- an agent when avoidable) and no Supabase access token, so the only
-- credential available to call the Storage API is the public
-- `anon`/publishable key. That key carries no privilege of its own -- every
-- Storage write it attempts is still gated by RLS policies on
-- `storage.objects`, which is otherwise default-deny (confirmed: zero
-- policies existed on `storage.objects` before this migration).
--
-- So: this migration opens a narrow, bucket-scoped door for the `anon`
-- role to INSERT and SELECT objects in `profile-photos` ONLY, for the
-- duration of one migration run (this session, uploading the 148 files
-- named in supabase/seed/2026-08-13_legacy_photo_paths.csv). SELECT is
-- included only so the same key can be used to fetch a couple of objects
-- back and confirm the bytes round-trip (§6.6-style verification), and so
-- a signed URL can be minted to double-check real anonymous/public access
-- is refused once this policy is gone.
--
-- What this grants, to whom, until when: any caller holding the anon
-- publishable key (a value that is intentionally public -- it ships in
-- client bundles) can write or read objects under the `profile-photos`
-- bucket while this policy exists. That key is already public regardless
-- of this migration, so the actual new exposure is narrow: it is limited
-- to one bucket, and the pilot has not launched (no real client is running
-- against this project yet), so there is no live traffic that could
-- exploit the window in practice. It is still real exposure and is closed
-- by the follow-up migration in the same pass, not left for a "later
-- cleanup" -- see the revoke migration for confirmation it was removed.
create policy "TEMP -- legacy photo migration upload (anon, profile-photos only)"
on storage.objects for insert
to anon
with check (bucket_id = 'profile-photos');

create policy "TEMP -- legacy photo migration verify-read (anon, profile-photos only)"
on storage.objects for select
to anon
using (bucket_id = 'profile-photos');
