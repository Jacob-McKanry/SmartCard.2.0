-- =============================================================================
-- 20260813191041_storage_rls_profile_photos.sql
--
-- WHAT THIS CHANGES
--   Adds the first real, permanent RLS policies on `storage.objects` for the
--   `profile-photos` bucket (created empty, with no access path, by
--   20260813180355_create_profile_photos_bucket.sql). Confirmed before writing
--   this — not assumed — that zero policies exist on `storage.objects` today:
--   the only one ever added was the temporary, migration-scoped legacy-import
--   policy in 20260813180402, and it was deliberately revoked in 20260813180755
--   once that import couldn't run in this environment. This migration is the
--   real, ongoing access path the Profile feature needs.
--
-- WHAT THIS GRANTS, EXACTLY, AND TO WHOM
--   An authenticated SmartCard user may INSERT, SELECT, UPDATE and DELETE
--   objects in the `profile-photos` bucket ONLY when the first path segment
--   of the object's key equals their own `public.users.id` — i.e. only under
--   `{their_user_id}/...`, the path convention architecture §6.5 specifies
--   (`{user_id}/{uuid}.webp`). `storage.foldername(name)` splits the object
--   key on `/` and returns it as a text[]; `[1]` is that first segment.
--
--   Nobody may read, write, or overwrite another user's photo path this way.
--   There is no branch here for "read a connection's photo" or anything
--   graph-gated the way `users`/`social_links` are (§3.4) — that is out of
--   scope for this pass per the build plan (no viewer-facing profile route
--   exists yet, so there is nothing for a wider read policy to serve) and is
--   flagged as a real gap to close, not silently deferred, when a viewer-facing
--   profile screen is actually built: at that point this policy's SELECT
--   branch is the one to widen, using the same `private.are_connected` /
--   `private.shares_event_with` helpers the `users` policy already uses, so
--   photo visibility tracks profile visibility instead of drifting from it.
--
--   `anon` gets nothing — no policy below names it, and RLS default-denies
--   absent a matching policy. (`storage.objects` itself, unlike our own
--   `public` tables, ships with broad table-level GRANTs to both `anon` and
--   `authenticated` from Supabase's own Storage extension setup — confirmed
--   via `information_schema.role_table_grants` before writing this, and left
--   untouched: that grant is Supabase-managed infrastructure this schema does
--   not own, and RLS is what actually gates access on this table regardless
--   of the grant, exactly as §3.6 observation 1 already established for
--   `public` tables. There is nothing to `revoke`+`grant` back here.)
--
-- WHY THIS IS NOT A PUBLIC BUCKET WITH A CONVENTION INSTEAD OF A POLICY
--   `profile-photos` stays `public = false` (set at creation). A photo is
--   profile data, and profile data is graph-gated (§3.4) — a public bucket
--   would let anyone who obtains or guesses an object path fetch the bytes
--   directly, no session, no signed URL, no RLS check at all, which would
--   quietly undermine the exact "no public profile URL" rule the rest of the
--   schema enforces (CLAUDE.md's non-negotiable product rule). Photos are
--   therefore served only through short-lived signed URLs
--   (`apps/web/src/server/profile/photo-url.ts`), minted by an authenticated
--   request and expiring shortly after — never a raw Storage URL handed to
--   the client. Signed-URL issuance itself goes through this same RLS: minting
--   one for a path you are not allowed to SELECT fails, so the policy below is
--   still the actual gate, not merely a write-side convenience.
--
-- WHY PATH-PREFIX RLS AND NOT A COLUMN CHECK
--   `storage.objects` has no `owner_user_id` column of ours to filter on —
--   Storage's own `owner`/`owner_id` columns are Supabase Auth identifiers,
--   meaningless here since Supabase Auth is not this app's identity provider
--   (§5.4). The object's `name` (its key/path) is the only value under our
--   control at write time, so the path convention *is* the ownership record,
--   and this is the standard Supabase-documented pattern for exactly that
--   situation: gate on `(storage.foldername(name))[1]`.
--
-- WHY `(select auth.uid())` AND NOT A BARE `auth.uid()`
--   Same reasoning as the `(select private.fn(...))` wrapping used throughout
--   `supabase/migrations` for this schema's own policies (§3.1): wrapping a
--   volatile-looking call in a scalar subquery lets Postgres evaluate it once
--   per statement instead of once per row.
--
-- WHY `auth.uid()` HERE, NOT `private.current_user_id()`
--   `private` is not exposed to the `storage` schema's policies any
--   differently than it is to `public`'s, but `auth.uid()` and
--   `private.current_user_id()` are the same value by construction —
--   `current_user_id()` is a thin wrapper over `auth.uid()`
--   (20260809210900) with no added table access, so calling `auth.uid()`
--   directly here is not a weaker check, just one fewer indirection for a
--   schema this migration doesn't otherwise touch. The Supabase JWT minted by
--   `mintSupabaseAccessToken()` (§5.4) sets `sub` to `public.users.id`, which
--   is exactly what `auth.uid()` reads — verified below by simulated session,
--   not assumed.
-- =============================================================================

create policy "read own profile photos only"
on storage.objects for select
to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "upload own profile photos only"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "replace own profile photos only"
on storage.objects for update
to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "delete own profile photos only"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
