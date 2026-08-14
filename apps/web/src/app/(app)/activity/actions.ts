"use server";

import { revalidatePath } from "next/cache";

import { getAuthenticatedContext, type AuthenticatedContext } from "@/server/auth/current-user";
import { removeConnection } from "@/server/connections/connections-service";
import { revokeCard } from "@/server/cards/cards-service";

/**
 * Server Actions for the Activity page (Q28).
 *
 * SAME SECURITY NOTE AS EVERY OTHER `actions.ts` IN THIS APP — copied because
 * the reasoning doesn't change per feature: a Server Action is a POST
 * endpoint reachable by anyone who can send the same request, not only by
 * someone who loaded this page first. Both actions below re-derive the
 * caller's identity from a fresh `getAuthenticatedContext()` call and write
 * through the RLS-bound client from that context — never the service role —
 * so the database policies are the real backstop regardless of what this
 * file gets right or wrong.
 *
 * Neither action redirects — both `revalidatePath("/activity")` and let the
 * caller stay put, unlike `removeConnectionAction` in the connections detail
 * feature (which sends the caller back to the list because there is nothing
 * left on that page once the connection is gone). Here the page itself is
 * the list; removing one item or revoking one card just means the next
 * render reflects it.
 */

async function requireContext(): Promise<AuthenticatedContext> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    throw new Error("You need to be signed in to do that.");
  }
  return context;
}

/** Removes the connection a tap created. Same one-way transition as the connections feature's own action. */
export async function removeConnectionFromActivityAction(connectionId: string): Promise<void> {
  const context = await requireContext();
  await removeConnection(context.supabase, connectionId);
  revalidatePath("/activity");
}

/** Revokes one of the caller's own cards — the kill switch for a lost or stolen card (§4.5). */
export async function revokeCardAction(cardId: string): Promise<void> {
  const context = await requireContext();
  await revokeCard(context.supabase, cardId, context.userId);
  revalidatePath("/activity");
}
