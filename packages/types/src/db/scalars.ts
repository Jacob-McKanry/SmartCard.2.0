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

/**
 * Strips every field-level `.default(...)` out of an object schema's shape,
 * for building a genuinely partial update schema out of an insert schema that
 * has defaults on it — e.g. `eventUpdateSchema = withoutDefaults(eventInsertSchema).partial().strict()`.
 *
 * WHY THIS EXISTS: `INSERT_SCHEMA.partial()` DOES NOT DO WHAT IT LOOKS LIKE IT
 * DOES, in Zod 4
 *
 * The obvious way to build an update schema from an insert schema is
 * `insertSchema.partial()` — every existing `*UpdateSchema` in this package
 * used to be written exactly that way, and for a field with no default that is
 * completely correct: the field becomes optional, and omitting it from an
 * update leaves it omitted. It is NOT correct for a field that carries
 * `.default(...)`, which every insert schema has for every column that is
 * optional on create (`description`, `visibility`, `display_order`, ...):
 * `.partial()` makes the KEY optional, but Zod still runs the field's own
 * schema — default included — against `undefined` when the key is missing,
 * which is precisely when the default fires. The result is that a caller who
 * sends `{ title: "New title" }` to update ONE field gets every other
 * defaulted column silently reset to its create-time value, not left alone.
 *
 * CONFIRMED, NOT ASSUMED (2026-08-22): `eventUpdateSchema.parse({ title: "x" })`
 * returned `visibility: "private"`, `capacity: null`, `requires_approval:
 * false` and five other fields that were never in the input, against zod
 * 4.4.3 — reproduced in isolation before touching either call site. The same
 * mechanism affects `socialLinkUpdateSchema` via `display_order`'s
 * `.default(0)`: editing a link's `platform` or `url` through
 * `updateSocialLinkAction` silently zeroed its `display_order`, live, on the
 * shipped web app — the two update schemas in this package built with plain
 * `.partial()` both had a default-bearing field. This was found while
 * building the mobile events routes, whose PATCH endpoint sends genuinely
 * minimal bodies (a mobile "rename this event" screen has no reason to also
 * resend `capacity`), which is what turned an already-real bug into one that
 * could not go unnoticed rather than an incidental one the web's own
 * always-complete-form submissions happened to paper over.
 *
 * WHY THIS IS A FUNCTION AND NOT "JUST CALL `.removeDefault()` INLINE TWICE"
 *
 * Because the failure mode is silent and the fix is easy to get subtly wrong
 * (removing defaults from the WRONG schema, or after `.partial()` instead of
 * before, produces no type error and passes a test that only checks the
 * happy path). One reviewed implementation, reused at both sites, is what
 * keeps a third `*InsertSchema.partial()` from reintroducing this by copying
 * the pattern that looks obviously right.
 *
 * `ZodDefault.removeDefault()` returns the schema the default was wrapping,
 * unwrapping exactly one layer — the field's own validation (type, range,
 * nullability) is unchanged, so a value that IS supplied is still checked
 * exactly as strictly as the insert schema checks it. A field with no default
 * passes through unchanged, so this is safe to apply to every field
 * unconditionally rather than needing to know which ones have defaults.
 */
export function withoutDefaults<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>): z.ZodObject<Shape> {
  const shape = schema.shape;
  const stripped = {} as Record<string, z.ZodTypeAny>;

  for (const [key, field] of Object.entries(shape)) {
    stripped[key] = (field instanceof z.ZodDefault ? field.removeDefault() : field) as z.ZodTypeAny;
  }

  // Typed as `z.ZodObject<Shape>` — the same shape the caller passed in —
  // rather than a mapped type computing "defaults removed" precisely. That
  // would be more honest at this line, but it buys nothing at the call site:
  // both current callers immediately chain `.partial()`, which wraps every
  // field in `.optional()` regardless of whether it used to carry a default,
  // so the type `z.infer` produces after `.partial()` is identical either
  // way. What actually changed is runtime behaviour (no field resurrects a
  // default when omitted), which no type signature can express or verify —
  // that is what the tests below are for.
  return z.object(stripped) as unknown as z.ZodObject<Shape>;
}
