"use server";

import { revalidatePath } from "next/cache";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { unblockUser } from "@/server/safety/blocks-service";

/**
 * Bound by the caller the same way `removeConnectionAction` is — see that
 * file's header for why a plain id-bound action, not a `FormData` read, is
 * the right shape when the id came from markup this page itself rendered.
 */
export async function unblockUserAction(targetUserId: string): Promise<void> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    throw new Error("You need to be signed in to do that.");
  }

  await unblockUser(context.supabase, targetUserId);
  revalidatePath("/MapTest/blocked");
}
