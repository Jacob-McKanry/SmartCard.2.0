-- Create the private Storage bucket for legacy profile photos.
--
-- Why: §6.5 of the architecture doc specifies a private `profile-photos`
-- bucket served only via signed URLs -- profile photos are graph-gated data
-- (same as the rest of `public.users`), so a public bucket would quietly
-- undermine the no-global-search / no-public-profile-URL rule that the rest
-- of the schema enforces. `public = false` is what makes the bucket private:
-- Supabase Storage refuses unauthenticated/anonymous reads of a non-public
-- bucket's objects unless a signed URL (or a matching RLS policy) is
-- presented.
--
-- Deliberately restrictive on top of "private": `allowed_mime_types` is
-- pinned to webp (the only format the legacy export produced, per §6.5's
-- "148 files, ~7MB" and the migrated CSV) and `file_size_limit` is set well
-- above the largest legacy file (170,214 bytes) with headroom for future
-- uploads, so a misbehaving client can't smuggle in an oversized or
-- unexpected-type object even before any upload-side validation exists in
-- application code (none does yet -- this bucket has no INSERT/SELECT
-- policy for any client role after this migration, see the two migrations
-- immediately following this one for why one existed briefly and was
-- removed).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 5242880, array['image/webp'])
on conflict (id) do nothing;
