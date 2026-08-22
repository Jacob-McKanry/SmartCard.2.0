import { apiErrorResponse, requireApiContext, requireSameOrigin } from "@/server/api/route-context";
import { softDeleteOwnAccount } from "@/server/account/account-service";

/**
 * `DELETE /api/v1/account` — self-serve account deletion. Mirrors
 * `deleteAccountAction` (`(app)/settings/actions.ts`): call the one RPC that
 * runs the whole operation in a single transaction, log the outcome, done.
 * No redirect and no `revalidatePath` here — both are web-only concepts; a
 * mobile client signs itself out and clears its own local state once this
 * returns `ok: true`.
 *
 * `AccountDeletionRefusedError` (not-authenticated, user-not-found,
 * account-not-active) is not a `UserFacingError`, so it collapses to this
 * route's ordinary generic-error response like any other unrecognised
 * throw, matching the web action's own posture: that file does not
 * special-case it either, and §4.2's "never confirm or deny more than
 * necessary" applies here too — none of those three reasons is something a
 * signed-in caller calling their own delete endpoint needs explained in
 * more detail than "that didn't work".
 *
 * `softDeleteOwnAccount` fails closed in both directions by its own design:
 * a transport failure throws with nothing changed, and a refusal throws
 * rather than being reported as success. Either way this route never tells
 * a caller their account is gone unless it actually is.
 */
export const dynamic = "force-dynamic";

export async function DELETE(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const context = await requireApiContext(request);

    const outcome = await softDeleteOwnAccount(context.supabase);

    // Logged rather than returned in detail, matching the web action: the
    // caller is about to lose their session, and a breakdown of how many of
    // their own cards/events/sessions were touched is operational detail for
    // whoever reads the logs after a restore request, not something this
    // response needs to carry.
    console.info("[account] soft delete committed", {
      userId: context.userId,
      alreadyDeleted: outcome.alreadyDeleted,
      cardsRevoked: outcome.cardsRevoked,
      eventsCancelled: outcome.eventsCancelled,
      sessionsRevoked: outcome.sessionsRevoked,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "DELETE /api/v1/account");
  }
}
