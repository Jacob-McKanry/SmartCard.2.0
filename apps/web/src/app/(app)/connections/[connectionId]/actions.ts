"use server";

import { revalidatePath } from "next/cache";

import { getAuthenticatedContext, type AuthenticatedContext } from "@/server/auth/current-user";
import { safeActionErrorMessage, UserFacingError } from "@/server/errors";
import {
  removeConnection,
  setMeetingLocationVisibility,
  setOwnParticipantFlags,
} from "@/server/connections/connections-service";
import type { ActionState } from "./action-state";

/**
 * Server Actions for the meeting-record detail page.
 *
 * SECURITY NOTE THAT APPLIES TO EVERY EXPORT IN THIS FILE — copied from
 * `apps/web/src/app/profile/actions.ts` because the reasoning is identical:
 * a Server Action is a POST endpoint reachable by anyone who can send the
 * same request, not only by someone who loaded this page first. Every
 * action here re-derives the caller's identity from a fresh
 * `getAuthenticatedContext()` call and performs its write through the
 * RLS-bound client from that context — never the service role — so the
 * database policies in `20260809211200_rls_policies_graph_and_meetings.sql`
 * are the real backstop regardless of what this file gets right or wrong.
 *
 * Every mutating action takes `meetingId`/`connectionId` as *bound* leading
 * arguments (`action.bind(null, meetingId, connectionId)`, the same pattern
 * `updateSocialLinkAction` uses) rather than reading them from form fields —
 * they come from server-rendered markup this page itself produced on the
 * previous render, not from anything the current request asserts. Ownership
 * of the row named by that id is still re-derived from the session and
 * re-checked by RLS on every call, exactly as if the id had been untrusted.
 */

async function requireContext(): Promise<AuthenticatedContext> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    throw new UserFacingError("You need to be signed in to do that.");
  }
  return context;
}

/**
 * Only a message deliberately written for a person crosses to the browser;
 * anything else becomes one generic sentence with the real error logged
 * server-side. See `@/server/errors` for why this is opt-in rather than a
 * filter over raw database text.
 */
function messageOf(error: unknown): string {
  return safeActionErrorMessage(error, "connections");
}

/**
 * "Share with mutual connections" toggle. `nextVisibility` is bound from the
 * button that renders the *other* value of the enum (see
 * `location-controls.tsx`) — there are only two values, so this is a plain
 * toggle rather than a form field a client could tamper with into a third,
 * nonexistent state; `setMeetingLocationVisibility` validates it against
 * `meetingPrivacyUpdateSchema` regardless.
 */
export async function setLocationVisibilityAction(
  meetingId: string,
  connectionId: string,
  nextVisibility: "participants_only" | "mutuals",
  _prevState: ActionState,
): Promise<ActionState> {
  const context = await requireContext();

  try {
    await setMeetingLocationVisibility(context.supabase, meetingId, {
      location_visibility: nextVisibility,
    });
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidatePath(`/connections/${connectionId}`);
  return { success: true };
}

/**
 * The caller's own "I agree to share this location" flag
 * (`meeting_participants.location_share_consent`). `nextConsent` is bound
 * the same way as above — this button always asserts the opposite of the
 * caller's own currently-rendered state.
 */
export async function setLocationConsentAction(
  meetingId: string,
  connectionId: string,
  nextConsent: boolean,
  _prevState: ActionState,
): Promise<ActionState> {
  const context = await requireContext();

  try {
    await setOwnParticipantFlags(context.supabase, meetingId, context.userId, {
      location_share_consent: nextConsent,
    });
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidatePath(`/connections/${connectionId}`);
  return { success: true };
}

/**
 * "Mark this meeting private" — the caller's own
 * `meeting_participants.marked_private`. This is a personal veto: the RLS
 * policy scopes the write to `user_id = current_user_id()`, so nothing this
 * action does can ever touch the other participant's row, and there is no
 * action anywhere in this file that could clear *their* flag on their
 * behalf. Turning the caller's own flag back off is still possible (this is
 * a toggle, not a one-way transition like `connections.status`) — that
 * asymmetry is deliberate and described in the page copy.
 */
export async function setMarkedPrivateAction(
  meetingId: string,
  connectionId: string,
  nextMarkedPrivate: boolean,
  _prevState: ActionState,
): Promise<ActionState> {
  const context = await requireContext();

  try {
    await setOwnParticipantFlags(context.supabase, meetingId, context.userId, {
      marked_private: nextMarkedPrivate,
    });
  } catch (error) {
    return { error: messageOf(error) };
  }

  revalidatePath(`/connections/${connectionId}`);
  return { success: true };
}

/**
 * Removes the connection (`status: 'active' -> 'removed'`).
 *
 * No confirmation step lives here — that belongs to the client component
 * that calls this (`remove-connection.tsx`), which requires a second
 * explicit click before this ever runs. This action does not repeat that
 * check; it simply performs the one irreversible-by-this-UI thing it's
 * asked to do, same as `removePhotoAction` in the Profile feature.
 *
 * DELIBERATE DEVIATION FROM THIS ACTION'S ORIGINAL BEHAVIOUR (design pass)
 *
 * It used to `redirect("/connections")` on the grounds that "there is nothing
 * left on this page to manage once the edge is gone". That was true when the
 * removed branch of `page.tsx` was a one-paragraph fallback for a bookmarked
 * URL. It is no longer true: `docs/design/DESIGN.md` §6 makes **Connection
 * removed** a designed destination in its own right — history stays, the rings
 * go dashed and greyed, and the screen's job is to state plainly that nothing
 * restores it — and the prototype's own confirm handler routes to that screen
 * rather than back to the list.
 *
 * Bouncing to the list instead would mean the one screen whose entire purpose
 * is to say "this is permanent, and here is what remains" is the one screen a
 * user never sees at the moment it applies. So the redirect is gone and both
 * paths are revalidated: this route re-renders into its removed state, and the
 * list drops the row. Nothing about *what is written* changed — the RLS
 * transition and its one-wayness are identical.
 *
 * TWO MORE PATHS ADDED 2026-08-28, FOUND BY A REPORT RATHER THAN ANTICIPATED.
 * `/profile`'s ring diagram and `/` (Home)'s "N connections, all made in
 * person" line both read `listOwnConnections` too, and neither was in this
 * list — so removing a connection updated `/connections` (which the user was
 * looking at) while leaving Next's Router Cache holding whichever count those
 * two pages last rendered, indefinitely, until something else happened to
 * revalidate them. The write itself was always correct (`status` really did
 * flip to `removed`, and a fresh, uncached load of either page always showed
 * the right number) — this was purely a cache the write never told to drop.
 * The visible symptom matched exactly: the count never went down, and the
 * *next* connection made would count up from the stale number rather than
 * the true one.
 */
export async function removeConnectionAction(connectionId: string): Promise<void> {
  const context = await requireContext();
  await removeConnection(context.supabase, connectionId);
  revalidatePath("/connections");
  revalidatePath(`/connections/${connectionId}`);
  revalidatePath("/profile");
  revalidatePath("/");
}
