-- =============================================================================
-- 20260813210000_connect_flow_config_and_attempt_columns.sql
--
-- WHAT THIS CHANGES
--   Applies the schema additions the architecture doc's §2.5 amendment (2026-08-13)
--   specified but deliberately left unapplied, plus the rate-limit thresholds
--   §4.6 requires but never numbered. Three things:
--
--     (a) Seven new `app_config` rows: the six automatic-radius-relaxation keys
--         from §2.5 amendment (a), and the notification-coalescing key from
--         §2.5 amendment (d).
--     (b) Three new columns on `connection_attempts` from §2.5 amendment (b),
--         so a relaxed acceptance stays separable from a normal one in the
--         pilot dataset (§4.4 amendment).
--     (c) The one index §2.5 amendment (b) asks for, plus six `app_config` rows
--         holding the §4.6 rate limits.
--
--   Nothing existing is altered or dropped. No policy changes: both tables are
--   already service-role-only with no policy and no grant (§3.5), and these
--   additions inherit that posture unchanged.
--
-- WHY THE RELAXATION VALUES ARE NOT NEGOTIABLE INDIVIDUALLY
--   §4.3's amendment names one hard constraint on these numbers: the relaxed
--   radius must stay far larger than the relaxed accuracy floor (500m against
--   150m, above 3:1). The accuracy floor is what stops a deliberately vague GPS
--   fix from fuzzing its way inside the radius (§4.7 threat 2); if the floor
--   ever approached the radius, the proximity check would be satisfiable by
--   imprecision alone and would stop meaning anything. Anyone tuning either row
--   must tune both and preserve that ratio.
--
-- WHY THERE IS NO `relaxation_state` TABLE
--   Recorded as a judgment call in the §4.3 amendment and honoured here:
--   "has this pair failed twice for distance in the last ten minutes?" is
--   answered by one indexed query against `connection_attempts`, which already
--   records the pair, the reason and the timestamp of every failure. A separate
--   state table would be a second source of truth that can disagree with the
--   audit log — and disagreement between an audit log and a live security
--   decision is the worst class of bug available here. The index in (c) is the
--   entire cost of that choice.
--
-- ACCESS GRANTED / FORBIDDEN
--   None granted, to anyone. `app_config` and `connection_attempts` have no RLS
--   policy and no grant to `anon` or `authenticated` (20260809211000 revoked
--   everything, and 20260809211100-211300 never granted any of it back), so the
--   new columns and rows are readable and writable only by the service role.
--   That is deliberate and load-bearing: `app_config` says exactly how far away
--   an attacker may stand and how long a token lives, and `connection_attempts`
--   holds the distances §4.2 step 7 forbids ever being returned to a user.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (a) app_config — automatic radius relaxation (§2.5 amendment (a), §4.3)
-- ---------------------------------------------------------------------------
-- Values are verbatim from the amendment's table. They are rows rather than
-- constants for the reason the original six are: a single UPDATE disables or
-- retunes the mechanism mid-event, with no deploy and no app-store review.
insert into public.app_config (key, value, description) values
  ('qr_relaxation_enabled', 'true'::jsonb,
   'Master switch for automatic GPS radius relaxation (§4.3 amendment). Setting this to false mid-event disables the whole mechanism without a deploy — the reason it is a row and not a constant.'),

  ('qr_relaxation_failure_threshold', '2'::jsonb,
   'How many distance/accuracy rejections by the same presenter+scanner pair, inside qr_relaxation_window_seconds, unlock ONE relaxed attempt for that pair (§4.3 amendment). Only distance/accuracy rejections count: a bad signature, an expired token or a block unlocks nothing, so an attacker cannot spend two junk requests to buy a wider radius.'),

  ('qr_relaxation_window_seconds', '600'::jsonb,
   'The window those failures must fall inside. Ten minutes reads as "we are still standing here trying", not "we failed this morning" (§4.3 amendment).'),

  ('qr_relaxed_max_distance_m', '500'::jsonb,
   'The relaxed radius. Still a proximity claim — a large venue, not a neighbourhood. Must be tuned together with qr_relaxed_max_accuracy_m, keeping the ratio above 3:1 (§4.3 amendment, property 3).'),

  ('qr_relaxed_max_accuracy_m', '150'::jsonb,
   'The relaxed accuracy floor (normal is 100). Loosened only slightly and deliberately kept far below the relaxed radius: the floor is what stops a deliberately vague fix fuzzing its way inside the radius (§4.7 threat 2), so a floor approaching the radius would make the check satisfiable by imprecision alone.'),

  ('qr_relaxation_cooldown_seconds', '3600'::jsonb,
   'After a pair''s relaxed attempt resolves — success OR failure — that pair reverts to normal thresholds and cannot re-trigger relaxation for an hour. Without this a determined pair could hold themselves permanently in relaxed mode by failing on purpose every few minutes (§4.3 amendment, property 2).');

-- ---------------------------------------------------------------------------
-- (a continued) app_config — card-tap notification coalescing (§2.5 amendment (d))
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value, description) values
  ('nfc_tap_notification_coalesce_seconds', '300'::jsonb,
   'Window inside which repeated taps of one card produce a single rolled-up notification to its owner instead of one push each (§4.5 amendment). A card left on a table at a conference can be tapped repeatedly, and thirty pushes in a minute trains the owner to ignore the alert that matters — which would destroy the detective control §4.7 threat 7 depends on.');

-- ---------------------------------------------------------------------------
-- (c) app_config — the §4.6 rate limits
-- ---------------------------------------------------------------------------
-- §4.6 lists which endpoints are limited and by what subject, but gives no
-- numbers. These are chosen here and are therefore judgment calls, recorded
-- with their reasoning rather than dropped in as bare constants. All are
-- per-hour windows; the enforcement mechanism is `public.rate_limit_events`
-- (20260813210200).
--
-- The sizing brief is Q22: assume a MEDIUM-TO-LARGE event. Under-sizing a limit
-- is the expensive direction of the error — a limit that bites a real attendee
-- at a real event breaks the product in front of the pilot audience, whereas a
-- generous limit still ends brute force, because the thing being brute-forced
-- (a 48-bit card suffix, a random session uuid) needs billions of guesses, not
-- hundreds.
insert into public.app_config (key, value, description) values
  ('rate_limit_qr_session_create_per_user_hour', '60'::jsonb,
   'Max QR sessions one user may create per hour (§4.6). One per minute: a presenter legitimately reopens the Connect screen many times at an event, and each open is one session. Well above real use, far below anything that makes session-id guessing viable.'),

  ('rate_limit_qr_redeem_per_user_hour', '60'::jsonb,
   'Max QR redeem attempts one user may make per hour (§4.6). Meeting sixty new people in an hour is already an extreme evening; this is a ceiling on automation, not on sociability.'),

  ('rate_limit_qr_redeem_failures_per_session', '5'::jsonb,
   'Failures against ONE session before that session is burned (§4.6, the one number the doc does state). Counted from connection_attempts rejections for the session rather than from a separate counter, for the same one-source-of-truth reason relaxation state is derived (§4.3 amendment).'),

  ('rate_limit_nfc_redeem_per_card_hour', '20'::jsonb,
   'Max successful-or-failed redeems of one card per hour (§4.6). This is the cap on how much damage a lost or stolen card does before its owner reacts to the notification (§4.7 threat 7), balanced against a card deliberately left on a table for people to tap.'),

  ('rate_limit_nfc_redeem_per_user_hour', '60'::jsonb,
   'Max card redeems one user may attempt per hour (§4.6). This is the limit that actually resists brute-forcing card codes, since a guesser must be a signed-in user; 60/hour against a 48-bit unique suffix is not a search that finishes.'),

  ('rate_limit_connect_per_ip_hour', '600'::jsonb,
   'Max requests to any connect endpoint from one IP per hour (§4.6). Deliberately generous per Q22(a): hundreds of attendees share one NAT IP on venue wifi, so this must never be the binding constraint at an event — the per-user and per-session limits are the ones doing the real work. It exists to stop a single host hammering the endpoints, not to police a venue.');

-- ---------------------------------------------------------------------------
-- (b) connection_attempts — columns that keep relaxed acceptances separable
-- ---------------------------------------------------------------------------
-- Why a new column rather than a third `outcome` value: §3.6 constrained
-- `outcome` to success|rejected on purpose, and called the friction of adding a
-- third value a feature, because this table's whole worth is cross-row
-- comparability. A `relaxed_success` outcome would silently under-count
-- successes in every "how many succeeded?" query written before it existed.
-- `radius_mode` is orthogonal to `outcome` and composes with it — relaxed
-- REJECTIONS are as interesting as relaxed successes (§4.4 amendment,
-- question 4).
--
-- Why not infer relaxation from `radius_config_used_m`: the number alone is
-- ambiguous over time. If the owner tunes `qr_max_distance_m` up to 500 after
-- the first event — exactly the tuning §4.4 anticipates — a stored 500 no
-- longer distinguishes "the relaxed path fired" from "the normal radius happens
-- to be 500 now". Audit data has to survive its own configuration history.
alter table public.connection_attempts
  add column radius_mode text not null default 'normal'
    check (radius_mode in ('normal', 'relaxed'));

-- The accuracy floor actually in force, for symmetry with the existing
-- radius_config_used_m. Its absence until now was an oversight the §2.5
-- amendment names: a rejection caused by the accuracy floor did not record what
-- the floor was, which makes exactly that rejection untunable.
alter table public.connection_attempts
  add column accuracy_config_used_m double precision;

-- On a relaxed attempt, names the earlier failure that unlocked it, so the
-- pilot analysis can read a relaxed success together with the failures that
-- preceded it instead of guessing at the pairing. SET NULL rather than CASCADE
-- for the same reason every other FK on this table is: an audit row must not
-- vanish because a row it points at did.
alter table public.connection_attempts
  add column relaxation_source_attempt_id uuid
    references public.connection_attempts(id) on delete set null;

comment on column public.connection_attempts.radius_mode is
  'normal | relaxed — whether this attempt was evaluated against the relaxed '
  'thresholds (§4.3 amendment). Explicit rather than inferred from '
  'radius_config_used_m, because that number becomes ambiguous the moment the '
  'normal radius is tuned (§2.5 amendment (b)).';

comment on column public.connection_attempts.accuracy_config_used_m is
  'The accuracy floor in force for this attempt. Never returned to a user, for '
  'the same reason distance_m is not (§4.2 step 7).';

comment on column public.connection_attempts.relaxation_source_attempt_id is
  'For a relaxed attempt, the earlier distance/accuracy rejection by this same '
  'pair that unlocked relaxation. Lets §4.4 question 3 ("did relaxation actually '
  'rescue people?") be answered by joining, not by guessing.';

-- ---------------------------------------------------------------------------
-- (c) The index the relaxation lookup performs on every QR attempt
-- ---------------------------------------------------------------------------
-- §2.5 amendment (b), verbatim. Every QR redeem asks "has this ordered pair had
-- distance/accuracy rejections in the last N seconds, and has it used a relaxed
-- attempt within the cooldown?" — both are (presenter, scanner) prefix lookups
-- ordered by time. Without this index that question is a sequential scan of the
-- audit log on the hot path of the most security-critical endpoint in the
-- product.
create index connection_attempts_pair_created_at_idx
  on public.connection_attempts (presenter_user_id, scanner_user_id, created_at desc);
