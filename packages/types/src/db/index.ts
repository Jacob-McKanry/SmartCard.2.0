/**
 * Row schemas for every table in the `public` schema, one file per table.
 *
 * These mirror `supabase/migrations` exactly — same column names, same types,
 * same nullability. The SQL is the source of truth for what the database will
 * accept; these schemas are the source of truth for what TypeScript believes,
 * and they are only useful while the two agree. A migration that changes a
 * column must change the matching file here in the same commit.
 *
 * Scope note: these describe *shapes*, not *permissions*. Which rows a caller
 * may actually read or write is decided by RLS, and cannot be inferred from a
 * type. Where a schema does encode part of the access model — the `*Update`
 * schemas, which mirror column-level GRANTs — that is called out at the schema.
 */
export * from "./scalars";
export * from "./enums";

export * from "./users";
export * from "./social-links";
export * from "./cards";
export * from "./events";
export * from "./event-rsvps";
export * from "./connection-sessions";
export * from "./meetings";
export * from "./meeting-locations";
export * from "./meeting-participants";
export * from "./connections";
export * from "./blocks";
export * from "./connection-attempts";
export * from "./app-config";
export * from "./contact-import-matches";
export * from "./pending-connections";
export * from "./user-push-tokens";
export * from "./rate-limit-events";
