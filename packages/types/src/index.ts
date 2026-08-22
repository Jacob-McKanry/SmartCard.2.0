// packages/types is the single source of truth for data shapes (§1.3 of the
// architecture proposal): one Zod schema drives both runtime validation and the
// TypeScript type derived from it via `z.infer`, so the two cannot drift.
//
// `./db` mirrors the database schema created by supabase/migrations — one file
// per table, with the same column names, types and nullability as the SQL.
// Anything added there must be added in the migration that creates the column,
// in the same change.
//
// `./connect` holds the request/response shapes for the connection-verification
// endpoints (§4.2, §4.5). They live here rather than beside the routes because
// §1.7 has one service layer reached by both platforms — the same schema types
// the route's validation, the browser's call, and (later) the mobile client's.
export * from "./db";
export * from "./connect";
export * from "./api";
