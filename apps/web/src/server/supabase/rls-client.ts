import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabasePublishableKey, supabaseUrl } from "@/server/env";

/**
 * A Supabase client that queries the database *as a specific user*, with every
 * RLS policy in force.
 *
 * This is the client essentially all application code should use. Its authority
 * comes from the minted token, so a query it issues can only ever return rows
 * the policies in `supabase/migrations` allow that user to see — the "second
 * lock" of §3.1 is engaged, and a mistake in our TypeScript results in a
 * missing row rather than a leaked one.
 *
 * Two implementation notes worth knowing:
 *
 *  - The token is supplied through supabase-js's `accessToken` hook rather than
 *    a hand-set `Authorization` header. That hook is the supported path for a
 *    non-Supabase-Auth identity, and it makes the library refuse
 *    `supabase.auth.*` entirely — which is correct here, because Supabase Auth
 *    is not our identity provider and calling into it would be a bug (§5.4).
 *  - A new client is created per request rather than cached. The token is the
 *    identity, so a shared client would be a shared identity; caching one
 *    across requests is how one user ends up reading another's data.
 */
export function rlsClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl(), supabasePublishableKey(), {
    accessToken: async () => accessToken,
  });
}
