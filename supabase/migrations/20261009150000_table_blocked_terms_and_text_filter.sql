-- =============================================================================
-- 20261009150000_table_blocked_terms_and_text_filter.sql
--
-- WHAT THIS CHANGES
--   Phase 2 of `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`:
--   the required content filter's backend (owner decision 13 — "a text filter
--   only at launch — an admin-editable blocked-term list enforced
--   automatically").
--     1. `public.blocked_terms` — the term list, seeded with a deliberately
--        tiny starter set.
--     2. `private.normalize_for_text_filter(text)` and
--        `private.text_violation(text, context)` — the AUTHORITATIVE check.
--     3. `public.list_blocked_terms(context)` — hands the active terms for one
--        context to a signed-in client, so the report sheet can show an
--        inline "this may be blocked" hint while typing. Hint only; the server
--        re-checks on submit.
--
--   Its only consumer in this phase is `submit_report`'s `details` field
--   (20261009150100) — the only free text any Phase 2 surface accepts. Notes,
--   bios and messages get wired in by the phases that build them.
--
-- HOW MATCHING WORKS (and why it is written this way)
--   Both the text and the term are NORMALIZED first: lower-cased, and every
--   run of characters that is not a letter or digit collapsed to one space,
--   then trimmed. So "Kill-Yourself!!" and "kill   yourself" both normalize to
--   "kill yourself".
--     * match_kind 'word': the normalized term must appear as whole word(s) —
--       `position(' ' || term || ' ' in ' ' || text || ' ')`. "ass" does not
--       match "class". Works for multi-word phrases too.
--     * match_kind 'substring': the normalized term may appear anywhere,
--       including inside a longer word. For terms that are never innocent as
--       part of another word.
--   No regular expressions are built from term text, so a term containing
--   regex metacharacters (".", "+", "(") cannot break or widen the match, and
--   an admin cannot accidentally write a pattern that matches everything.
--   `packages/core/src/safety/text-filter.ts` mirrors this exactly for the
--   client hint, with its own tests; where the two could ever disagree (the
--   exact Unicode letter/digit classes of Postgres's `[:alnum:]` vs
--   JavaScript's `\p{L}\p{N}`), THIS function is the one that decides.
--
-- WHY `applies_to` IS A CLOSED SET, CHECKED IN TWO PLACES
--   `applies_to` names the contexts a term is enforced in. A typo there
--   ('report_detail') would silently make a term apply nowhere — the filter
--   switched off with no error, the one failure mode a filter must not have
--   (the same reasoning `rate_limit_events.subject_kind`'s CHECK gives,
--   20260813210200). So the column CHECK admits only known contexts and must
--   be non-empty, AND `text_violation` RAISES on an unknown context instead
--   of answering false, so a later phase that calls it with a misspelled
--   context fails loudly in its first test rather than letting everything
--   through. Later phases widen BOTH lists together (`'note'`, `'bio'`,
--   `'message'`), in the migration that adds the first caller — the same
--   "widen a CHECK together with its caller" convention as
--   `blocks.source` (20261009130000).
--
-- WHY THE LIST IS READABLE BY SIGNED-IN CLIENTS (list_blocked_terms)
--   The phase brief asks for a live, inline hint in the report sheet, which
--   needs the terms in the browser. Considered: keeping the list secret. It
--   was rejected because secrecy is not what makes this control work — anyone
--   can probe the server check by submitting text — and the list's whole
--   purpose is to be applied, not hidden. What a reader gains is the list of
--   words they cannot use, which is the message the hint exists to deliver.
--   The function returns ONLY active terms for the one context asked for,
--   to `authenticated` only (never `anon`), and the table itself has no
--   client grant at all.
--
-- ADMIN-EDITABLE THE SAME WAY `cities` IS
--   `cities` (20260814051100) has no client write grant: edits go through
--   the service role or a migration. `blocked_terms` takes the identical
--   posture — no client INSERT/UPDATE/DELETE, no admin RPC. An admin UI for
--   the list is not part of this phase. The amendment's §10 makes "the
--   content-filter wordlist is seeded" a LAUNCH GATE for the owner: the
--   starter rows below are there so the mechanism is exercised end to end,
--   not as the real list.
--
-- A PRODUCT CONCERN WITH FILTERING *REPORT* TEXT, FLAGGED NOT RESOLVED
--   A person reporting harassment will often want to quote it, and the words
--   most worth blocking elsewhere are exactly the ones a victim would quote.
--   Rejecting a report for containing them is the wrong failure for a safety
--   channel. This migration does what the phase brief specifies (the details
--   field is filtered, server-side, and refused on a hit), keeps the starter
--   list to a handful of unambiguous phrases, and the report sheet's refusal
--   copy tells the person to describe rather than quote. Whether report
--   details should instead be FLAGGED for the admin rather than REFUSED is a
--   decision for the owner; it is a one-line change in `submit_report`.
--
-- ACCESS GRANTED / FORBIDDEN BY THIS MIGRATION
--   Grants: EXECUTE on `public.list_blocked_terms(text)` to `authenticated`
--     — returns (term, match_kind, applies_to) of ACTIVE terms for the given
--     context only; an unknown context returns nothing.
--   Forbids: every privilege on `public.blocked_terms` to every client role
--     (forced RLS, zero policies, zero grants). `private.text_violation` and
--     `private.normalize_for_text_filter` are executable by no client role.
--     `anon` gets nothing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. blocked_terms
-- ---------------------------------------------------------------------------
create table public.blocked_terms (
  id uuid primary key default gen_random_uuid(),
  term text not null
    check (char_length(btrim(term)) between 1 and 100),
  match_kind text not null
    check (match_kind in ('word', 'substring')),
  -- Closed, non-empty set of contexts — see the header.
  applies_to text[] not null
    check (cardinality(applies_to) > 0 and applies_to <@ array['report_details']::text[]),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.blocked_terms is
  'The admin-managed text-filter term list (owner decision 13 of the '
  '2026-10-09 live-map amendment; 20261009150000). Enforced by '
  'private.text_violation. No client grant: edited with the service role or a '
  'migration, like cities. The starter rows are placeholders — seeding the '
  'real list is an owner launch gate (amendment §10).';

comment on column public.blocked_terms.applies_to is
  'Contexts this term is enforced in. Closed set: ''report_details'' only in '
  'Phase 2; later phases widen this CHECK and the list inside '
  'private.text_violation together.';

-- One row per (normalized-ish) term and kind, so the list cannot silently grow
-- duplicate rows that disagree about is_active.
create unique index blocked_terms_term_kind_key
  on public.blocked_terms (lower(btrim(term)), match_kind);

create trigger blocked_terms_set_updated_at
  before update on public.blocked_terms
  for each row execute function private.tg_set_updated_at();

alter table public.blocked_terms enable row level security;
alter table public.blocked_terms force row level security;
revoke all on public.blocked_terms from public, anon, authenticated;

-- Starter set: a handful of unambiguous self-harm-directed harassment phrases,
-- nothing a person describing their own experience needs verbatim. NOT the
-- real list — see the header.
insert into public.blocked_terms (term, match_kind, applies_to) values
  ('kys', 'word', array['report_details']),
  ('kill yourself', 'word', array['report_details']),
  ('go die', 'word', array['report_details'])
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. normalization + the authoritative check
-- ---------------------------------------------------------------------------
create or replace function private.normalize_for_text_filter(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(coalesce(p_text, '')), '[^[:alnum:]]+', ' ', 'g'));
$$;

comment on function private.normalize_for_text_filter(text) is
  'Lower-cases and collapses every run of non-letter/digit characters to one '
  'space, then trims. Mirrored by normalizeForTextFilter() in '
  'packages/core/src/safety/text-filter.ts (20261009150000).';

revoke all on function private.normalize_for_text_filter(text) from public, anon, authenticated;

create or replace function private.text_violation(p_text text, p_context text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_text text;
begin
  -- Unknown context RAISES rather than answering false — see the header.
  -- Widen this list together with blocked_terms.applies_to's CHECK.
  if p_context is null or p_context not in ('report_details') then
    raise exception 'unknown text-filter context: %', coalesce(p_context, '<null>')
      using errcode = '22023';
  end if;

  v_text := private.normalize_for_text_filter(p_text);
  if v_text = '' then
    return false;
  end if;

  return exists (
    select 1
    from public.blocked_terms t
    where t.is_active
      and p_context = any (t.applies_to)
      and private.normalize_for_text_filter(t.term) <> ''
      and (
        (t.match_kind = 'word'
          and position(' ' || private.normalize_for_text_filter(t.term) || ' '
                       in ' ' || v_text || ' ') > 0)
        or
        (t.match_kind = 'substring'
          and position(private.normalize_for_text_filter(t.term) in v_text) > 0)
      )
  );
end;
$$;

comment on function private.text_violation(text, text) is
  'True if p_text contains an active blocked term for p_context (whole-word or '
  'substring, after normalization). The AUTHORITATIVE content-filter check; '
  'the TypeScript mirror is a client-side hint only. Raises 22023 on an '
  'unknown context so a misspelled caller fails loudly (20261009150000).';

revoke all on function private.text_violation(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. public.list_blocked_terms — the client hint's data
-- ---------------------------------------------------------------------------
create or replace function public.list_blocked_terms(p_context text)
returns table (term text, match_kind text, applies_to text[])
language sql
stable
security definer
set search_path = ''
as $$
  select t.term, t.match_kind, t.applies_to
  from public.blocked_terms t
  where private.current_user_id() is not null
    and t.is_active
    and p_context = any (t.applies_to)
  order by t.term;
$$;

comment on function public.list_blocked_terms(text) is
  'Active blocked terms for one context, for the client-side inline hint only '
  '(the server re-checks with private.text_violation on submit). Signed-in '
  'callers only; an unknown context returns nothing (20261009150000).';

revoke all on function public.list_blocked_terms(text) from public, anon;
grant execute on function public.list_blocked_terms(text) to authenticated;
