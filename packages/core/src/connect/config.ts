/**
 * The `app_config` thresholds the connect flow reads, as a typed object.
 *
 * Every value here is a database row, never a constant (§4.3): GPS is genuinely
 * unreliable indoors, the radius will be wrong on day one, and tuning it must
 * not require a deploy or an app-store review. This module's only job is to
 * turn the rows into something typed, and — much more importantly — to REFUSE
 * rather than guess when a row is missing or malformed.
 *
 * WHY A MISSING ROW IS A HARD FAILURE
 * The tempting alternative is a default: `qr_max_distance_m ?? 150`. That
 * default is a security threshold chosen by whoever last edited a TypeScript
 * file, silently overriding the row an operator thought they were tuning — and
 * if the row is missing because someone deleted it mid-event, the app carries
 * on at a radius nobody set. Worse, `Number(undefined)` is `NaN`, and every
 * comparison against `NaN` is `false`, so a naive parse turns "no configured
 * radius" into "no radius at all". `parseVerificationConfig` throws instead,
 * the endpoint returns a generic failure, and no connection is created. That is
 * the fail-closed posture CLAUDE.md requires on this path.
 */

import { z } from "zod";

/** Every key the connect flow reads. Closed set, so a typo is a compile error. */
export const CONNECT_CONFIG_KEYS = [
  // §2.5, seeded 2026-08-09
  "qr_max_distance_m",
  "qr_max_accuracy_m",
  "qr_token_ttl_seconds",
  "qr_rotation_seconds",
  "presenter_location_max_age_seconds",
  "session_max_lifetime_seconds",
  // §2.5 amendment (a) — automatic radius relaxation
  "qr_relaxation_enabled",
  "qr_relaxation_failure_threshold",
  "qr_relaxation_window_seconds",
  "qr_relaxed_max_distance_m",
  "qr_relaxed_max_accuracy_m",
  "qr_relaxation_cooldown_seconds",
  // §2.5 amendment (d) — card-tap notification coalescing
  "nfc_tap_notification_coalesce_seconds",
  // §4.6 rate limits
  "rate_limit_qr_session_create_per_user_hour",
  "rate_limit_qr_redeem_per_user_hour",
  "rate_limit_qr_redeem_failures_per_session",
  "rate_limit_nfc_redeem_per_card_hour",
  "rate_limit_nfc_redeem_per_user_hour",
  "rate_limit_connect_per_ip_hour",
] as const;

export type ConnectConfigKey = (typeof CONNECT_CONFIG_KEYS)[number];

const positiveNumber = z.number().finite().positive();
const nonNegativeNumber = z.number().finite().nonnegative();

export const verificationConfigSchema = z.object({
  qr_max_distance_m: positiveNumber,
  qr_max_accuracy_m: positiveNumber,
  qr_token_ttl_seconds: positiveNumber,
  qr_rotation_seconds: positiveNumber,
  presenter_location_max_age_seconds: positiveNumber,
  session_max_lifetime_seconds: positiveNumber,

  qr_relaxation_enabled: z.boolean(),
  qr_relaxation_failure_threshold: z.number().int().min(1),
  qr_relaxation_window_seconds: positiveNumber,
  qr_relaxed_max_distance_m: positiveNumber,
  qr_relaxed_max_accuracy_m: positiveNumber,
  qr_relaxation_cooldown_seconds: nonNegativeNumber,

  nfc_tap_notification_coalesce_seconds: nonNegativeNumber,

  rate_limit_qr_session_create_per_user_hour: z.number().int().min(1),
  rate_limit_qr_redeem_per_user_hour: z.number().int().min(1),
  rate_limit_qr_redeem_failures_per_session: z.number().int().min(1),
  rate_limit_nfc_redeem_per_card_hour: z.number().int().min(1),
  rate_limit_nfc_redeem_per_user_hour: z.number().int().min(1),
  rate_limit_connect_per_ip_hour: z.number().int().min(1),
});

export type VerificationConfig = z.infer<typeof verificationConfigSchema>;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * Turns raw `app_config` rows into a `VerificationConfig`, or throws.
 *
 * The one non-obvious check is the last one, and it is the most important line
 * in this file. §4.3's amendment states the single hard constraint on the
 * relaxed values: the relaxed radius must stay far larger than the relaxed
 * accuracy floor (it specifies 500m against 150m, "above 3:1"). The accuracy
 * floor is what stops a deliberately vague fix from fuzzing its way inside the
 * radius (§4.7 threat 2); if someone tunes the floor up toward the radius
 * during an event — the exact circumstance in which these rows get edited in a
 * hurry — the proximity check becomes satisfiable by imprecision alone and
 * stops meaning anything, silently, with no error anywhere.
 *
 * So the ratio is enforced here rather than left as advice in a comment. A
 * configuration that violates it is refused, which disables connecting until it
 * is fixed. That is the correct direction: an event where nobody can connect is
 * a visible outage someone fixes in a minute; an event where the proximity gate
 * quietly stopped working is not visible at all.
 */
export const MIN_RELAXED_RADIUS_TO_ACCURACY_RATIO = 3;

export function parseVerificationConfig(
  rows: Iterable<{ key: string; value: unknown }>,
): VerificationConfig {
  const raw: Record<string, unknown> = {};
  for (const row of rows) {
    raw[row.key] = row.value;
  }

  const missing = CONNECT_CONFIG_KEYS.filter((key) => raw[key] === undefined || raw[key] === null);
  if (missing.length > 0) {
    throw new ConfigurationError(
      `app_config is missing required key(s): ${missing.join(", ")}. ` +
        `The connect flow refuses to run on defaults — see the header of packages/core/src/connect/config.ts.`,
    );
  }

  const parsed = verificationConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigurationError(
      `app_config holds an unusable value: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const config = parsed.data;

  if (
    config.qr_relaxed_max_distance_m <
    config.qr_relaxed_max_accuracy_m * MIN_RELAXED_RADIUS_TO_ACCURACY_RATIO
  ) {
    throw new ConfigurationError(
      `Relaxed radius (${config.qr_relaxed_max_distance_m}m) must stay at least ` +
        `${MIN_RELAXED_RADIUS_TO_ACCURACY_RATIO}x the relaxed accuracy floor ` +
        `(${config.qr_relaxed_max_accuracy_m}m). §4.3 amendment, property 3: below that ratio the ` +
        `proximity check is satisfiable by imprecision alone and stops meaning anything.`,
    );
  }

  // The same reasoning applies to the normal pair, which §4.3 seeds at 150/100
  // — a ratio of only 1.5. That is the signed-off starting point and is NOT
  // enforced here, deliberately: refusing it would refuse the configuration the
  // architecture ships with. It is flagged in `relaxation.ts` as the thing to
  // watch in pilot data instead.

  return config;
}
