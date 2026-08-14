-- Revokes the temporary, user-id-scoped anon upload/verify-read policy
-- opened by 20260814000100_temp_photo_migration_upload_policy_v2.sql.
--
-- Applied once the 148-file upload (run from the signed-in owner's browser
-- via the temporary /internal/photo-backfill page) is complete and
-- independently verified against storage.objects -- not on a timer, and not
-- left open "in case a retry is needed": the same fail-closed posture the
-- first attempt's revoke migration used. The temporary admin page itself is
-- deleted from the codebase in the same pass that applies this migration,
-- so there is nothing left afterward that could even attempt to use this
-- door once it is shut.
--
-- Net effect after this migration: back to exactly the four permanent,
-- own-folder-only policies from 20260813191041_storage_rls_profile_photos.sql
-- -- `anon` has no access to storage.objects again, same as before either
-- temporary window existed.
drop policy if exists "TEMP -- legacy photo migration upload v2 (anon, known user ids only)"
  on storage.objects;

drop policy if exists "TEMP -- legacy photo migration verify-read v2 (anon, known user ids only)"
  on storage.objects;
