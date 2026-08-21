import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Claiming a blank card — the thin TypeScript half of
 * `public.claim_unassigned_card` (20260821120000).
 *
 * WHY THERE IS ALMOST NOTHING HERE, AND WHY THAT IS THE POINT
 *
 * Every decision this feature makes is in the database function: resolving the
 * code, refusing `assigned` and `revoked`, both rate limits, and the atomic
 * transition itself. This file does not re-check any of them, and must not
 * start to. The function is granted to `authenticated`, so it is reachable
 * directly over PostgREST by anyone holding a session — a check added here
 * would guard the app's own call and nothing else, while reading like a
 * guarantee. The migration's header sets this out at length under "WHY THE RATE
 * LIMIT IS INSIDE THIS FUNCTION".
 *
 * WHY THE CALLER'S OWN CLIENT AND NOT THE SERVICE ROLE
 *
 * Same posture as `cards-service.ts` and `connections-service.ts`. The function
 * is `security definer` precisely so it can do its work without the caller
 * holding any privilege on `public.cards` — it takes the owner from the JWT via
 * `private.current_user_id()`, so it needs a real session on the connection to
 * identify anybody at all. Calling it with the service role would make
 * `auth.uid()` null and the claim would refuse, which is the safe direction but
 * would also mean the feature never worked.
 *
 * WHY THE CODE IS NOT VALIDATED HERE FIRST
 *
 * The function applies the same shape filter itself, and duplicating
 * `cardCodeSchema` here would put the pattern in two places — the drift this
 * repo keeps legislating against. A malformed code costs one round trip and is
 * refused without a lookup.
 */

/**
 * The result of a claim attempt, which is deliberately a boolean and not a
 * reason.
 *
 * The function answers `{"ok": boolean}` and nothing more, so an attempt cannot
 * be used to tell an unknown code from a revoked one from one somebody else
 * already owns. That collapsing is a security property of the RPC, not a
 * limitation of this wrapper, so this type has nowhere to widen to — if a
 * future screen wants to explain WHY a claim failed, the honest answer is that
 * it cannot be told, and the conversation belongs at the migration.
 */
export interface CardClaimResult {
  claimed: boolean;
}

/**
 * Attempts to claim `cardCode` for whoever the `supabase` client is
 * authenticated as.
 *
 * Throws only on a transport or server failure — a REFUSED claim is a normal
 * outcome and comes back as `{ claimed: false }`. The distinction matters to
 * the caller: a throw is "we could not ask", which is a monitoring problem,
 * while `false` is "we asked and the answer was no", which is a thing to tell
 * the person holding the card.
 */
export async function claimUnassignedCard(
  supabase: SupabaseClient,
  cardCode: string,
): Promise<CardClaimResult> {
  const { data, error } = await supabase.rpc("claim_unassigned_card", {
    p_card_code: cardCode,
  });

  if (error) {
    throw new Error(`Failed to claim card: ${error.message}`, { cause: error });
  }

  // Defensive rather than decorative: `data` is whatever PostgREST decoded, and
  // a shape this does not recognise must read as "not claimed". Treating an
  // unexpected payload as success would hand somebody a card the database may
  // never have given them.
  const claimed = typeof data === "object" && data !== null && (data as { ok?: unknown }).ok === true;

  return { claimed };
}
