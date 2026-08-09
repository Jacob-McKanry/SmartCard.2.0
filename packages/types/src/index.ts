// packages/types is the single source of truth for data shapes (§1.3 of the
// architecture proposal): one Zod schema drives both runtime validation and the
// TypeScript type derived from it via `z.infer`, so the two cannot drift.
//
// `./db` mirrors the database schema created by supabase/migrations — one file
// per table, with the same column names, types and nullability as the SQL.
// Anything added there must be added in the migration that creates the column,
// in the same change.
//
// Request/response schemas for the API (§1.7) and the verification-input
// schemas from §4.1 are not here yet: those belong with the routes and the
// verification service that define them, and will land in the phases that build
// them.
export * from "./db";
