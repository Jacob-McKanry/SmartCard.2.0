"use server";

import { revalidatePath } from "next/cache";
import { uuidSchema } from "@smartcard/types";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { safeActionErrorMessage } from "@/server/errors";
import { decideHostApplication } from "@/server/hosting/host-application-service";
import type { DecideHostApplicationActionState } from "./action-state";

/**
 * The Server Action behind the admin review queue's approve/reject buttons.
 *
 * A Server Action is reachable on its own, not only from a page behind
 * `/admin/...` — the note every `actions.ts` here carries — so this re-derives
 * the caller fresh and then does nothing else to decide who may call it.
 * Whether the caller is an active admin, and whether the application id is
 * real, are both decided inside `decide_host_application` itself, which
 * refuses both cases with the identical message (§3.6-style) so this cannot be
 * used to probe which ids exist.
 *
 * `approve` arrives as the literal string `"approve"` or `"reject"` from two
 * separate submit buttons on the same form (`name="decision"`), not a single
 * checkbox — a form with one boolean field defaults to a value on submit
 * either way, and the action this button takes must never be ambiguous about
 * which decision an untouched control means.
 */
export async function decideHostApplicationAction(
  _prevState: DecideHostApplicationActionState,
  formData: FormData,
): Promise<DecideHostApplicationActionState> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    return { error: "You need to be signed in to do that." };
  }

  const parsedId = uuidSchema.safeParse(formData.get("applicationId"));
  if (!parsedId.success) {
    return { error: "That application isn't available." };
  }

  const decision = formData.get("decision");
  if (decision !== "approve" && decision !== "reject") {
    return { error: "Something about that action didn't come through correctly." };
  }

  const rejectionNote = formData.get("rejectionNote");

  try {
    await decideHostApplication(
      context.supabase,
      parsedId.data,
      decision === "approve",
      typeof rejectionNote === "string" && rejectionNote.trim() !== "" ? rejectionNote : undefined,
    );
  } catch (error) {
    return { error: safeActionErrorMessage(error, "hosting/admin") };
  }

  revalidatePath("/admin/host-applications");
  return {};
}
