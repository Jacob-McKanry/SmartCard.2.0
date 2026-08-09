// packages/api-client will hold typed functions for calling our API once
// routes exist (§1.7 of the architecture proposal): mobile calls these over
// HTTP against Next.js Route Handlers, web calls them directly from Server
// Components/Actions where convenient. Depends on packages/types so every
// request/response is validated against the same Zod schemas the database
// migration will mirror.
import { placeholderSchema } from "@smartcard/types";

// Placeholder only, to prove the workspace wiring
// (apps -> packages/api-client -> packages/types) resolves correctly.
export function placeholder(): boolean {
  return placeholderSchema.parse({ ok: true }).ok;
}
