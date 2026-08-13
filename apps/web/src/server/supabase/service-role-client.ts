import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseServiceRoleKey, supabaseUrl } from "@/server/env";

/**
 * A Supabase client that bypasses every RLS policy in the database.
 *
 * READ THIS BEFORE IMPORTING IT ANYWHERE.
 *
 * The service role is not "an admin login" — it is the absence of the second
 * lock. Architecture §3 puts the real access rules in Postgres so that an
 * application bug cannot leak a row; a query issued through this client is
 * outside that protection entirely, and its correctness rests solely on the
 * TypeScript around it. §5.4 is explicit that this is the *fallback* posture
 * (Option B) and that using it for the general request path would make RLS
 * decorative.
 *
 * So it has exactly one caller on the request path: `ensureUser()`, which must
 * read and write `public.users` at a moment when the caller has no Supabase
 * identity yet — the identity is the thing being established. There is
 * deliberately no client-facing INSERT policy on `users`
 * (`20260809211100_rls_policies_identity_and_cards.sql`) because a client that
 * could insert its own row could choose its own `kinde_user_id`, which is
 * choosing which account it is. Routing account creation through a
 * client-writable path to avoid needing this key would reintroduce exactly that
 * hole.
 *
 * Adding a second caller is a decision, not a convenience. If a feature seems
 * to need this client, first check whether it actually needs a policy.
 */

let cached: SupabaseClient | null = null;

export function serviceRoleClient(): SupabaseClient {
  if (cached === null) {
    cached = createClient(supabaseUrl(), supabaseServiceRoleKey(), {
      auth: {
        // There is no user session here and there must never be one: this
        // client's authority comes from the key, not from a signed-in person.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return cached;
}
