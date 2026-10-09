"use server";

import { revalidatePath } from "next/cache";
import { uuidSchema } from "@smartcard/types";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { safeActionErrorMessage } from "@/server/errors";
import {
  adminResolveReport,
  adminSuspendUser,
  adminUnsuspendUser,
} from "@/server/safety/moderation-service";
import type { ReportQueueActionState } from "./action-state";

/**
 * Every RPC re-checks `private.is_admin()` itself and fails closed — see
 * `moderation-service.ts`'s header. This file adds no authorization of its
 * own; it only re-derives the caller fresh and reads form fields, the same
 * posture `host-applications/actions.ts` takes.
 */
export async function dismissReportAction(
  _prevState: ReportQueueActionState,
  formData: FormData,
): Promise<ReportQueueActionState> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    return { error: "You need to be signed in to do that." };
  }

  const parsedId = uuidSchema.safeParse(formData.get("reportId"));
  if (!parsedId.success) {
    return { error: "That report isn't available." };
  }

  const note = formData.get("note");

  try {
    await adminResolveReport(
      context.supabase,
      parsedId.data,
      "dismissed",
      typeof note === "string" && note.trim() !== "" ? note : undefined,
    );
  } catch (error) {
    return { error: safeActionErrorMessage(error, "safety/admin-resolve") };
  }

  revalidatePath("/MapTest/admin/reports");
  return {};
}

export async function suspendFromReportAction(
  _prevState: ReportQueueActionState,
  formData: FormData,
): Promise<ReportQueueActionState> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    return { error: "You need to be signed in to do that." };
  }

  const parsedReportId = uuidSchema.safeParse(formData.get("reportId"));
  const parsedTargetId = uuidSchema.safeParse(formData.get("targetUserId"));
  if (!parsedReportId.success || !parsedTargetId.success) {
    return { error: "That report isn't available." };
  }

  const note = formData.get("note");

  try {
    await adminSuspendUser(
      context.supabase,
      parsedTargetId.data,
      parsedReportId.data,
      typeof note === "string" && note.trim() !== "" ? note : undefined,
    );
  } catch (error) {
    return { error: safeActionErrorMessage(error, "safety/admin-suspend") };
  }

  revalidatePath("/MapTest/admin/reports");
  return {};
}

export async function unsuspendUserAction(targetUserId: string): Promise<void> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    throw new Error("You need to be signed in to do that.");
  }

  await adminUnsuspendUser(context.supabase, targetUserId);
  revalidatePath("/MapTest/admin/reports");
}
