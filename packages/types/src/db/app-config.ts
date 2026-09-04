/**
 * `public.app_config` — see
 * 20260809210700_table_connection_attempts_and_app_config.sql
 *
 * The tunable thresholds the connection-verification gate reads. Every one of
 * them is a row rather than a constant because GPS is unreliable indoors and
 * the radius has to be adjustable while an event is happening — a constant in
 * TypeScript needs a deploy, and one in the mobile bundle needs an app store
 * review (§4.3).
 *
 * Service role only: no policy, no grant to `authenticated`. These values must
 * not reach a client, because they say exactly how far away an attacker may
 * stand and how long a token stays valid.
 */
import { z } from "zod";

import { jsonbSchema, timestamptzSchema, uuidSchema } from "./scalars";

/**
 * Every key seeded by a migration. Typed as a closed set so a typo in a lookup
 * is a compile error rather than a silent `undefined` that the caller then
 * treats as "no limit".
 *
 * Six seeded 2026-08-09 (§2.5); thirteen added 2026-08-13 by
 * 20260813210000 — the six relaxation keys (§2.5 amendment (a)), the
 * notification-coalescing key (amendment (d)), and the six §4.6 rate limits,
 * whose numbers the architecture never specified and whose reasoning is
 * recorded in that migration.
 *
 * Two more added 2026-08-14 by 20260814061000 for automatic event tagging
 * (§2.6). They are the only keys here that are NOT security thresholds: they
 * are read after a connection has already been accepted, and decide only
 * whether the resulting meeting is labelled with an event. That migration's
 * header says so at length, because the distinction is invisible from the
 * table.
 *
 * Two more added 2026-08-15 by 20260815120000 for the non-user card preview.
 * They are the only rows here read by a request with NO SIGNED-IN USER behind
 * it, which is why they exist at all: every §4.6 limit that resists guessing a
 * card code is keyed to a user, and there is no account to charge on that path.
 *
 * They are also the only keys in this list that `parseVerificationConfig`
 * (`packages/core/src/connect/config.ts`) deliberately does NOT read. That
 * function treats its key list as closed and refuses the whole connect flow if
 * any single row is missing — right for keys the connect flow reads, wrong for
 * these two, where it would mean a missing preview row stops people connecting
 * in person. The preview reads its own rows in
 * `apps/web/src/server/cards/card-preview-service.ts` and refuses only itself.
 * The rule that is NOT relaxed is the important one: still no default, still a
 * throw on a missing or unusable value.
 */
export const appConfigKeySchema = z.enum([
  "qr_max_distance_m",
  "qr_max_accuracy_m",
  "qr_token_ttl_seconds",
  "qr_rotation_seconds",
  "presenter_location_max_age_seconds",
  "session_max_lifetime_seconds",

  "qr_relaxation_enabled",
  "qr_relaxation_failure_threshold",
  "qr_relaxation_window_seconds",
  "qr_relaxed_max_distance_m",
  "qr_relaxed_max_accuracy_m",
  "qr_relaxation_cooldown_seconds",

  "nfc_tap_notification_coalesce_seconds",

  "event_geofence_radius_m",
  "event_auto_tag_default_window_hours",

  "rate_limit_qr_session_create_per_user_hour",
  "rate_limit_qr_redeem_per_user_hour",
  "rate_limit_qr_redeem_failures_per_session",
  "rate_limit_nfc_redeem_per_card_hour",
  "rate_limit_nfc_redeem_per_user_hour",
  "rate_limit_connect_per_ip_hour",

  "rate_limit_card_preview_per_ip_hour",
  "rate_limit_card_preview_per_card_hour",

  // Added 20260904100000 for the event attendee roster (§3.6 of
  // 2026-08-27-event-attendee-roster.md): the two budgets keyed on a
  // (viewer, event) pair via the new `user_event` rate_limit_events kind.
  "rate_limit_roster_profile_open_per_user_event_day",
  "rate_limit_roster_contact_save_per_user_event_day",
]);
export type AppConfigKey = z.infer<typeof appConfigKeySchema>;

export const appConfigRowSchema = z.object({
  /**
   * Deliberately `string`, not `appConfigKeySchema`: the column is plain text
   * and a future migration may add a key, so a row read back must still parse.
   * Use `appConfigKeySchema` when *looking a value up*, where the closed set is
   * what you want.
   */
  key: z.string(),

  /** `jsonb`. Every key seeded so far holds a number — see `appConfigNumberSchema`. */
  value: jsonbSchema,

  description: z.string().nullable(),
  updated_at: timestamptzSchema,

  /** Which admin last changed a threshold; survives their deletion (SET NULL). */
  updated_by: uuidSchema.nullable(),
});

export type AppConfigRow = z.infer<typeof appConfigRowSchema>;

/**
 * Parser for the value of a threshold key.
 *
 * Every threshold is a non-negative number of metres, seconds or attempts. The
 * one exception is `qr_relaxation_enabled`, which is a boolean master switch —
 * use `z.boolean()` for that one, not this.
 *
 * Parsing through this rather than casting means a malformed config row — a
 * string, a null, a negative — throws at the point of use, so the gate refuses
 * to run rather than silently comparing against `NaN`, which would compare
 * false and let everything through.
 *
 * `packages/core/src/connect/config.ts` parses the whole set at once and is the
 * thing the connect flow actually uses; it additionally refuses a configuration
 * whose relaxed radius has been tuned too close to its relaxed accuracy floor,
 * which is the one invariant §4.3's amendment says must never be broken.
 */
export const appConfigNumberSchema = z.number().min(0);
