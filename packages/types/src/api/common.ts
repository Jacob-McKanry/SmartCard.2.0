import { z } from "zod";

/**
 * The bare success envelope every mutating `/api/v1/*` route answers with
 * when it has nothing else to report — a revoke, a delete, a PATCH that only
 * confirms the write landed. One shared schema rather than one per route,
 * because the shape never varies: `{ ok: true }` and nothing else.
 */
export const okResponseSchema = z.object({ ok: z.literal(true) });
