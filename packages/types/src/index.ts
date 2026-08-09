// packages/types is the single source of truth for data shapes once the
// database schema lands: one Zod schema per table/row will drive both
// runtime validation (parsing API responses, form input) and the
// TypeScript types derived from it (`z.infer<...>`), so the shape can't
// drift between the two. The next phase (database schema + RLS) populates
// this file to mirror docs/architecture/2026-08-09-initial-architecture-proposal.md
// §2 exactly — field names are deliberately not pre-guessed here.
import { z } from "zod";

// Placeholder only, to prove the workspace wiring (apps -> packages/types)
// and the zod dependency resolve correctly.
export const placeholderSchema = z.object({ ok: z.literal(true) });
export type Placeholder = z.infer<typeof placeholderSchema>;
