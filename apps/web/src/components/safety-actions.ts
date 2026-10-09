"use server";

import { uuidSchema } from "@smartcard/types";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { safeActionErrorMessage } from "@/server/errors";
import { blockUser } from "@/server/safety/blocks-service";
import { REPORT_CATEGORIES, submitReport, type ReportCategory } from "@/server/safety/reports-service";

/**
 * The Server Actions behind `block-action.tsx` and `report-sheet.tsx` — the
 * two shared safety components a later phase drops onto real pages
 * (profile, connections, roster, and eventually map pins/threads/hangouts)
 * with just a `targetUserId` prop. Shared because the components themselves
 * are shared: one action per RPC, re-derived fresh from the session on every
 * call, the same posture every `actions.ts` in this app already takes.
 */

/**
 * Bound by the caller the same way `remove-connection.tsx` binds
 * `removeConnectionAction` — a plain action, no FormData, matching
 * `ConfirmPanel`'s `() => void | Promise<void>` contract. Throws on refusal
 * (`UserFacingError`-wrapped messages surface through Next's own error
 * handling, the same as the connection-removal action it mirrors); there is
 * no success/error state object because the block itself is never refused
 * in a way worth showing differently from "blocked" — see `block_user`'s own
 * comment on why it answers `{ok:true}` even when nothing was written.
 */
export async function blockUserAction(targetUserId: string): Promise<void> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    throw new Error("You need to be signed in to do that.");
  }

  const parsedId = uuidSchema.safeParse(targetUserId);
  if (!parsedId.success) {
    throw new Error("That person isn't available to block.");
  }

  await blockUser(context.supabase, parsedId.data);
}

export interface ReportActionState {
  error?: string;
  done?: boolean;
}

export const initialReportActionState: ReportActionState = {};

export async function submitReportAction(
  _prevState: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    return { error: "You need to be signed in to do that." };
  }

  const parsedId = uuidSchema.safeParse(formData.get("targetUserId"));
  if (!parsedId.success) {
    return { error: "That person isn't available to report." };
  }

  const category = formData.get("category");
  if (typeof category !== "string" || !(REPORT_CATEGORIES as readonly string[]).includes(category)) {
    return { error: "Pick a category for the report." };
  }

  const details = formData.get("details");

  try {
    await submitReport(
      context.supabase,
      parsedId.data,
      category as ReportCategory,
      typeof details === "string" && details.trim() !== "" ? details : undefined,
    );
  } catch (error) {
    return { error: safeActionErrorMessage(error, "safety/report") };
  }

  return { done: true };
}
