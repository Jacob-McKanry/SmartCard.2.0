-- =============================================================================
-- 20260809210200_table_cards.sql
--
-- WHAT THIS CHANGES
--   Creates `public.cards`, the registry of physical NFC cards, in the form
--   settled by Q1 (architecture doc §2.2, "Q1 resolved 2026-08-09"): a single
--   `card_code` column and no separate secret token. This supersedes the
--   earlier draft of §2.2 which assumed the printed code was guessable and
--   planned a second `card_token` column alongside it.
--
-- WHY THERE IS NO SECOND SECRET
--   The code physically encoded on all 7,142 existing cards is
--   `<cosmetic-prefix>-<12 hex chars>`, e.g. `CUSTOM-f2a930bcb5fe`. The suffix
--   was verified across the entire production export to be unique and exactly
--   12 hex characters — 48 bits of randomness that is not user-chosen. That is
--   already an unguessable lookup value, so `card_code` carries both roles:
--   the human-visible label and the security-bearing secret. Adding a second
--   token would have meant re-encoding 6,809 pieces of unassigned stock to gain
--   nothing. Brute-force guessing is handled by rate limiting on redeem (§4.6),
--   not by adding entropy that is already there.
--
--   Consequence worth remembering: because the code IS the secret, `card_code`
--   must never be exposed for a card the caller does not own. The select policy
--   in 20260809211100 restricts rows to the owner for exactly this reason.
--
-- ACCESS
--   No policies here (see 20260809211100). Redeeming a tapped card is a
--   server-side lookup by `card_code` performed by the verification service
--   (§4.5 step 4), which runs with the service role — the client never gets to
--   query this table by code, and the client's claim about who owns a card is
--   never trusted.
-- =============================================================================

create table public.cards (
  id uuid primary key default gen_random_uuid(),

  -- The exact string that appears in the tag URL after `/card/`. UNIQUE is
  -- load-bearing, not hygiene: `card_code` is how a tap resolves to a person,
  -- so a duplicate would make one tap ambiguous between two owners.
  card_code text not null unique,

  status text not null default 'unassigned'
    check (status in ('unassigned', 'assigned', 'revoked')),

  -- RESTRICT, not CASCADE or SET NULL. A card is a physical object that exists
  -- whether or not its owner's row does; deleting a person should not delete
  -- inventory, and should not silently return their card to the unassigned pool
  -- either. Forcing the delete to fail makes a human decide (revoke? reassign?)
  -- before a hard user delete can proceed.
  owner_user_id uuid references public.users(id) on delete restrict,

  assigned_at timestamptz,
  created_at timestamptz not null default now(),

  -- Migration traceability (§6.3). UNIQUE for the same reason as
  -- `users.legacy_user_id`: a re-run of the import fails loudly instead of
  -- duplicating 7,142 rows.
  legacy_card_id bigint unique,

  -- §4.5 step 4 requires an assigned card to have a non-null owner before a tap
  -- can create a connection. Enforcing it here means that check cannot be
  -- skipped by a code path that forgets it — an "assigned" card with no owner
  -- is not a state the database will hold.
  constraint cards_assigned_requires_owner
    check (status <> 'assigned' or owner_user_id is not null)
);

comment on table public.cards is
  'Physical NFC card inventory. `card_code` is both the printed label and the '
  'security-bearing lookup value (§2.2, Q1 resolved) — treat it as a secret for '
  'any card the caller does not own.';

comment on column public.cards.card_code is
  'Format `<cosmetic-prefix>-<12 hex chars>`. The 48-bit suffix is the entropy; '
  'the prefix is a vanity label chosen by the owner and carries no security value. '
  'Future card orders must keep generating suffixes the same way (§2.2).';

comment on column public.cards.status is
  'unassigned | assigned | revoked. `revoked` is the owner-triggered kill switch '
  'for a lost or stolen card (§4.5) and is the only status transition a client is '
  'allowed to make.';

create index cards_owner_user_id_idx on public.cards (owner_user_id);
