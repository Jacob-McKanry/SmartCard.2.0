-- =============================================================================
-- 20260814051400_storage_event_covers_bucket_and_rls.sql
--
-- WHAT THIS CHANGES
--   Gives `events.cover_image_path` somewhere to point. Creates the private
--   `event-covers` Storage bucket, one helper that turns an object path back
--   into the event it belongs to, and four RLS policies on `storage.objects`
--   scoped to that bucket.
--
--   `cover_image_path` has existed as a bare `text` column since
--   20260809210300 with no bucket, no policy and no convention — a column
--   nothing could legally fill. This is the pass that makes it real.
--
-- THE PATH CONVENTION IS THE ACCESS CONTROL, SO IT IS EXACT
--       {event_id}/cover.{jpg|jpeg|png|webp}
--   and nothing else is a valid object in this bucket. `storage.objects` has no
--   column of ours to filter on — its own `owner`/`owner_id` are Supabase Auth
--   identifiers, meaningless here because Supabase Auth is not this app's
--   identity provider (§5.4) — so the key IS the ownership record, the same
--   situation `profile-photos` is in (20260813191041).
--
--   But the RULE is different, and that difference is the whole reason this
--   file cannot copy that one. `profile-photos` gates on
--   `(storage.foldername(name))[1] = auth.uid()`: the owner is literally in the
--   path, so the check is a string comparison. An event cover's uploader is
--   NOT in its path — the path names the event — so the policies here have to
--   join back to `public.events` to find out who the host is, and reading
--   `public.events` from a `storage` policy needs a `security definer` helper
--   (`private.is_event_host`, 20260814051200), because the storage schema's
--   owner has no business holding a grant on our tables and `public.events`
--   has FORCE ROW LEVEL SECURITY.
--
--   Pinning the filename to exactly `cover.<ext>` does two jobs beyond
--   tidiness: an event can hold at most one cover object, so a host cannot
--   quietly use their event as unbounded personal storage; and the path is
--   *derivable* from the event id, so nothing has to trust a client-supplied
--   path to find an event's cover.
--
-- WHY THE CAST TO uuid IS BEHIND A HELPER AND NOT WRITTEN INLINE
--   `((storage.foldername(name))[1])::uuid` inside a policy raises `22P02`
--   (invalid input syntax) the moment any object in the bucket has a
--   non-uuid first segment. In a policy an error is not a denial — it is a
--   failed query for whoever tripped over it, and a way to make the whole
--   bucket unreadable by writing one bad key. `private.event_cover_event_id()`
--   pattern-matches first and returns NULL for anything that does not conform,
--   and NULL makes both `can_see_event` and `is_event_host` false. Malformed
--   input therefore denies, quietly, which is what fail-closed means here.
--
-- WHAT THIS GRANTS, EXACTLY, AND TO WHOM
--   On objects whose `bucket_id = 'event-covers'` and whose key conforms to the
--   convention above, for role `authenticated` only:
--
--     SELECT  to anyone who can already see the event
--             (`private.can_see_event`) — i.e. any authenticated user for a
--             PUBLIC event, and for a PRIVATE event only its host and people
--             who already hold an RSVP row for it.
--     INSERT
--     UPDATE  to the event's host, and nobody else.
--     DELETE
--
--   FORBIDS everything to `anon` (no policy names it), everything in every
--   other bucket (each policy is bucket-scoped, so `profile-photos`' four
--   policies stay the only rules that apply there), and any object key that
--   does not match the convention — including a host's own upload to a path
--   they made up, which fails the same check a stranger's would.
--
--   Note what the SELECT branch deliberately is NOT: it is not "public",
--   because a private event's cover is part of that private event. And it is
--   not "owner only" the way `profile-photos` is, because an event cover exists
--   precisely to be seen by the people looking at the event. Read access to the
--   image tracks read access to the row, which is the property that keeps the
--   two from drifting apart later.
--
-- WHY THE BUCKET IS PRIVATE AND SERVED BY SIGNED URL
--   Same reasoning as `profile-photos`, and it still applies even though a
--   public event's row is readable by every authenticated user: `public = false`
--   means Storage refuses anonymous fetches, so a cover cannot be hotlinked out
--   of the app by anyone holding a guessed or leaked path, and a PRIVATE
--   event's cover is not fetchable by someone who cannot see the event at all.
--   Images are minted as short-lived signed URLs by
--   `apps/web/src/server/events/cover-url.ts`, through the caller's own
--   RLS-bound client — Storage enforces these policies at SIGNING time, not
--   only at fetch time, so the policy below is the real gate rather than a
--   write-side convenience.
--
-- WHY `auth.uid()` AND NOT `private.current_user_id()`
--   Identical to 20260813191041's reasoning: they are the same value by
--   construction (`current_user_id()` is a thin wrapper over `auth.uid()` with
--   no added table access), and `auth.uid()` is one fewer indirection in a
--   schema this migration does not otherwise touch. Wrapped as `(select ...)`
--   so Postgres evaluates it once per statement instead of once per row.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------
-- MIME types are pinned to the three formats a browser will reliably render,
-- and the size limit is generous for a cover image but not for anything else.
-- Both are enforced by Storage before any application code runs, which is the
-- point: a validation that lives only in an upload helper is a validation that
-- a direct API call skips.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-covers',
  'event-covers',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- private.event_cover_event_id
-- ---------------------------------------------------------------------------
-- "Which event does this object key belong to?" — NULL for anything that is not
-- exactly `{uuid}/cover.{jpg|jpeg|png|webp}`.
--
-- `immutable`: it is pure string parsing with no table access, so Postgres may
-- fold it wherever it likes. It does not need `security definer` for the same
-- reason — there is nothing here the caller could not compute themselves. It
-- still needs an EXECUTE grant to `authenticated`, because a policy expression
-- re-checks function EXECUTE against the CALLING role; that correction is the
-- entire subject of 20260809211400 and is the easiest thing in this schema to
-- get wrong twice.
create or replace function private.event_cover_event_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/cover\.(jpg|jpeg|png|webp)$'
      then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

comment on function private.event_cover_event_id(text) is
  'Maps an `event-covers` object key to its event id, or NULL if the key does '
  'not match the {event_id}/cover.{ext} convention exactly. Pattern-matches '
  'before casting so a malformed key denies (NULL fails every check) instead of '
  'raising 22P02 inside a policy.';

revoke all on function private.event_cover_event_id(text) from public, anon;
grant execute on function private.event_cover_event_id(text) to authenticated;

-- `private.is_event_host` (20260814051200) is called from the three write
-- policies below, so it needs the same EXECUTE grant for the same reason. This
-- does not make it reachable: USAGE on schema `private` remains revoked, so it
-- cannot be named in a query, and PostgREST cannot see the schema at all — the
-- containment argument 20260809211400 makes for the other seven helpers applies
-- unchanged. `private.can_see_event` was already granted there.
grant execute on function private.is_event_host(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
create policy "read event covers for events you can see"
on storage.objects for select
to authenticated
using (
  bucket_id = 'event-covers'
  and (select private.can_see_event(
         (select auth.uid()),
         private.event_cover_event_id(name)))
);

create policy "upload a cover only for an event you host"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'event-covers'
  and (select private.is_event_host(
         (select auth.uid()),
         private.event_cover_event_id(name)))
);

-- Both USING and WITH CHECK, so a host can neither take over somebody else's
-- cover object nor rename their own out of their event's prefix into another
-- event's. The pre-image and the post-image must both be an event they host.
create policy "replace a cover only for an event you host"
on storage.objects for update
to authenticated
using (
  bucket_id = 'event-covers'
  and (select private.is_event_host(
         (select auth.uid()),
         private.event_cover_event_id(name)))
)
with check (
  bucket_id = 'event-covers'
  and (select private.is_event_host(
         (select auth.uid()),
         private.event_cover_event_id(name)))
);

create policy "delete a cover only for an event you host"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'event-covers'
  and (select private.is_event_host(
         (select auth.uid()),
         private.event_cover_event_id(name)))
);
