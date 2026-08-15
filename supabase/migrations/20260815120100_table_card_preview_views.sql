-- =============================================================================
-- 20260815120100_table_card_preview_views.sql
--
-- WHAT THIS CHANGES
--   Creates `public.card_preview_views` — one row per occasion on which this
--   product showed a cardholder's contact details to somebody who was not
--   signed in. Table and indexes only; RLS, grants and the one policy are in
--   20260815120200, kept separate so the access rules can be read on their own.
--
-- READ THIS FIRST: THIS FEATURE OPENS THE PRODUCT'S FIRST UNAUTHENTICATED READ
--   Until now, `20260809211000_rls_enable_default_deny.sql` could say without
--   qualification: "`anon` is never granted anything by any migration in this
--   set — there is no such thing as an unauthenticated read in this product."
--   That sentence is now narrower than it was, and pretending otherwise in a
--   comment would be the worst outcome available here.
--
--   What has NOT changed: `anon` still holds no grant on any table, and no
--   policy anywhere is evaluated for an unauthenticated database caller. The
--   database's answer to `anon` is still "nothing", everywhere. What HAS changed
--   is that a Next.js server route now performs a service-role read on behalf of
--   a visitor with no account, and returns a fixed, hardcoded subset of one
--   `users` row to them. The lock that stops that read going wrong is no longer
--   RLS — it is the TypeScript in
--   `apps/web/src/server/cards/card-preview-service.ts`, which is why that file
--   carries a header saying so.
--
--   The project owner made this call knowingly, with the risks written out:
--   preview is ON for every assigned, active card, with no per-user opt-out
--   column, and the preview includes phone number and email. This table exists
--   because a disclosure that leaves no trace is a disclosure nobody can audit,
--   and because §4.7 threat 7's whole defence is detection rather than
--   prevention.
--
-- WHY A NEW TABLE RATHER THAN `connection_attempts`
--   `connection_attempts` earns its keep through cross-row comparability: §4.4's
--   tuning questions are all "how many attempts failed for reason X, at what
--   distance, against which threshold?", asked over the whole dataset. A preview
--   is a different event class entirely — no attempt at a connection is made, no
--   verification runs, there is no distance, no radius, no session in the card
--   case and no scanner identity in either. Writing preview rows into that table
--   would silently change the denominator of every query already written against
--   it (the exact failure §2.5 amendment (b) cites as the reason `radius_mode`
--   is a column rather than a third `outcome` value), in exchange for reusing
--   columns that would all be null.
--
-- WHAT IS RECORDED AND WHAT IS DELIBERATELY NOT
--   Recorded: successful DISCLOSURES only — one row each time details were
--   actually shown. Not recorded: refusals.
--
--   That split is deliberate and worth defending, because the reflex is to log
--   everything. A refused preview (unknown code, revoked card, suspended owner,
--   over budget) already leaves a row in `public.rate_limit_events`, because
--   `rate_limit_consume` records BEFORE it counts and the preview path consumes
--   its budget before it knows whether it will refuse. So refusals are already
--   counted, already keyed by hashed IP, and already pruned by
--   `rate_limit_prune`. Writing them here as well would add a second copy of the
--   same signal in a table with no prune job, fed by an endpoint any anonymous
--   caller can hit — i.e. it would hand an unauthenticated visitor an unbounded
--   write into our database. The division is: `rate_limit_events` counts what
--   was ATTEMPTED, this table records what was DISCLOSED.
--
--   No raw card code is stored, ever, even for a failed guess. `card_code` is
--   the credential (§2.2, Q1), so a table full of attempted codes would be a
--   table full of near-misses and, for any correct guess, a second copy of a
--   live secret. A successful preview stores `card_id` instead, which is
--   already the safe handle for the same card.
--
-- WHY `ip_hash` AND NOT AN IP
--   Same rule as `connection_attempts.ip_hash` and
--   `rate_limit_events.subject_key`: an IP is personal data, and every use this
--   column has (tell two visits apart, spot a burst) needs only that the value
--   be comparable to itself. The hashing happens at the edge in
--   `request-context.ts` so a raw address never reaches this layer at all.
-- =============================================================================

create table public.card_preview_views (
  -- bigint identity, matching `rate_limit_events` rather than the uuid PKs used
  -- across the graph tables. Nothing references this row, nothing is fetched by
  -- its id, and the §4.7 threat 5 reason for uuid keys — "try id + 1" as an
  -- enumeration attack — cannot apply to a table with no by-id read path.
  id bigint generated always as identity primary key,

  viewed_at timestamptz not null default now(),

  -- Which of the two entry points resolved this preview. CHECKed because,
  -- unlike `rate_limit_events.action`, this genuinely is a closed set: there
  -- are exactly two routes that can produce a preview, and a third would be a
  -- new unauthenticated read path that must not be able to appear without a
  -- migration somebody had to write.
  --   card_code — GET /card/<code> by a signed-out visitor (a tapped NFC card)
  --   qr_token  — GET /c/<token>, the URL a presenter's QR actually encodes
  source text not null
    check (source in ('card_code', 'qr_token')),

  -- What was handed over. Both are real disclosures of the same seven fields;
  -- they are distinguished because they mean different things to the person
  -- being previewed. "Someone opened my card link" is ambient; "someone saved
  -- my contact card to their phone" is the one they may want to act on.
  surface text not null
    check (surface in ('preview', 'vcard')),

  -- WHOSE details were shown. NOT NULL: a row in this table means "this
  -- person's contact details left the building", and a row that cannot say
  -- whose is not an audit record of anything. Cascade, because the whole point
  -- of a soft `status = 'deleted'` is that a hard delete is an administrative
  -- act — and an administrator hard-deleting a person should not leave behind
  -- rows describing when that person's phone number was disclosed.
  --
  -- This is the one place this table deviates from the "audit rows outlive
  -- their subject" convention §2.1 sets for `connection_attempts` (SET NULL).
  -- The reason is that this table's subject is the VICTIM of a disclosure
  -- rather than the actor in an attempt: retaining a disclosure log about
  -- somebody who has been erased is retaining data about them, not about
  -- whoever looked.
  subject_user_id uuid not null references public.users(id) on delete cascade,

  -- Which card, for a `card_code` preview. SET NULL rather than CASCADE for the
  -- ordinary audit reason: the record of a disclosure must not vanish because
  -- a piece of inventory was deleted.
  card_id uuid references public.cards(id) on delete set null,

  -- Which QR session, for a `qr_token` preview. Same reasoning.
  session_id uuid references public.connection_sessions(id) on delete set null,

  ip_hash text,

  -- Bounded at the application edge before it reaches here (512 chars, see
  -- `buildRequestContext`), because it is attacker-controlled text.
  user_agent text,

  -- The two origins are mutually exclusive: a card preview has no session and a
  -- QR preview has no card.
  --
  -- Written as "must be null" rather than the tighter "and the other must be
  -- NOT NULL" on purpose. Both FKs above are ON DELETE SET NULL, so a tighter
  -- constraint would make deleting a card fail with a check violation on an
  -- unrelated audit table — turning a routine administrative act into a
  -- confusing error a long way from its cause.
  constraint card_preview_views_origin_is_exclusive check (
    (source = 'card_code' and session_id is null)
    or (source = 'qr_token' and card_id is null)
  )
);

comment on table public.card_preview_views is
  'One row per occasion the product showed a cardholder''s contact details to '
  'somebody with no account (the non-user preview on /card/<code> and /c/<token>). '
  'Successful DISCLOSURES only — refused previews are already counted in '
  'rate_limit_events, which records before it counts. Service role writes; the '
  'subject reads their own rows (20260815120200) so a card found and enumerated '
  'is not invisible to its owner.';

comment on column public.card_preview_views.subject_user_id is
  'Whose details were disclosed. CASCADE, unlike connection_attempts'' SET NULL: '
  'this table''s subject is the person disclosed ABOUT, so keeping the row after '
  'a hard delete would be retaining data about an erased person.';

comment on column public.card_preview_views.surface is
  'preview | vcard — whether the page was rendered or the contact file was '
  'downloaded. Two requests, two disclosures, two rows; both also spend '
  'rate-limit budget.';

comment on column public.card_preview_views.ip_hash is
  'HMAC of the caller''s IP with CONNECT_IP_HASH_SALT, never a raw address — '
  'the same treatment connection_attempts.ip_hash and '
  'rate_limit_events.subject_key get, for the same reason.';

-- The Activity screen's only query: "my previews, newest first", capped.
create index card_preview_views_subject_viewed_at_idx
  on public.card_preview_views (subject_user_id, viewed_at desc);

-- Both FKs are indexed. Not for a query anybody runs — for deletes: an
-- unindexed FK turns removing one card, or one session, into a sequential scan
-- of this table, and `connection_sessions` rows are created by every single
-- card tap.
create index card_preview_views_card_id_idx
  on public.card_preview_views (card_id)
  where card_id is not null;

create index card_preview_views_session_id_idx
  on public.card_preview_views (session_id)
  where session_id is not null;
