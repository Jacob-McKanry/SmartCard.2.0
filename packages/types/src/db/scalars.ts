/**
 * Shared column-level building blocks for the database row schemas.
 *
 * Every schema in `src/db` mirrors one table created by the migrations in
 * `supabase/migrations`. These helpers exist so a Postgres type is spelled the
 * same way everywhere, and so the reasoning behind each mapping is written down
 * once rather than re-litigated per file.
 */
import { z } from "zod";

/**
 * `uuid`. Every primary key in this schema is a UUID rather than a sequential
 * integer, so that a leaked or guessed id cannot be walked (`id + 1`) into
 * someone else's row — architecture proposal §2 / §4.7 threat 5.
 *
 * `z.guid()` rather than `z.uuid()` on purpose. Zod's `uuid()` enforces the
 * RFC 9562 version and variant nibbles; Postgres's `uuid` type does not — it
 * accepts any 32 hex digits. Using the stricter validator would mean a value
 * Postgres stored happily could fail to parse on the way back out, which is
 * exactly the drift these schemas exist to prevent. It would also reject the
 * readable fixture ids (`1111...`) that make policy tests legible.
 * `gen_random_uuid()` produces conforming v4 values either way.
 */
export const uuidSchema = z.guid();

/**
 * `timestamptz`, as PostgREST serialises it: an ISO-8601 string with an offset,
 * e.g. `2026-08-09T21:12:13.318451+00:00`.
 *
 * Deliberately not format-validated. These values are produced by Postgres
 * itself, so a stricter pattern here could only ever reject well-formed data —
 * it would add false failures without catching a real class of bug. Format
 * validation belongs on *input* (a user-supplied date in a form), not on values
 * read back out of our own database.
 */
export const timestamptzSchema = z.string();

/**
 * `double precision`, used for GPS coordinates, accuracy radii and computed
 * distances.
 *
 * Range checks (latitude -90..90, longitude -180..180, accuracy >= 0) are
 * enforced by CHECK constraints in the migrations, so a row read back is
 * already known to satisfy them. They are repeated here only where a schema is
 * also plausibly used to validate input.
 */
export const doublePrecisionSchema = z.number();

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);
export const accuracyMetresSchema = z.number().min(0);

/**
 * `integer`.
 */
export const integerSchema = z.number().int();

/**
 * `bigint`, used only by the two `legacy_*_id` traceability columns.
 *
 * PostgREST serialises bigint as a JSON number, and the legacy ids involved are
 * small (337 users, 7,142 cards), so the 2^53 precision ceiling of a JS number
 * is not reachable here. Any future bigint column that could exceed that must
 * be typed as a string instead.
 */
export const bigintSchema = z.number().int();

/**
 * `citext` — a case-insensitive string. From the client's point of view it is
 * an ordinary string; the case-insensitivity is a property of comparison and
 * uniqueness inside Postgres, not of the value.
 *
 * Note this is *not* `z.email()` for `users.email`. The row schemas mirror what
 * the database actually guarantees, and the column enforces uniqueness, not
 * format. Using a stricter schema here would mean a legitimately stored row
 * could fail to parse on the way out.
 */
export const citextSchema = z.string();

/**
 * `jsonb`. Only `app_config.value` uses it.
 */
export const jsonbSchema = z.json();
