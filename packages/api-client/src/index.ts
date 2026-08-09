// packages/api-client will hold typed functions for calling our API once
// routes exist (§1.7 of the architecture proposal): mobile calls these over
// HTTP against Next.js Route Handlers, web calls them directly from Server
// Components/Actions where convenient. Depends on packages/types so every
// request/response is validated against the same Zod schemas that mirror the
// database migrations.
import { userStatusSchema } from "@smartcard/types";

// Placeholder only, to prove the workspace wiring
// (apps -> packages/api-client -> packages/types) resolves correctly. It parses
// against a real schema now that packages/types mirrors the database, rather
// than against a stand-in object shape.
export function placeholder(): string {
  return userStatusSchema.parse("active");
}
