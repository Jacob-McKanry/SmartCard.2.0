"use server";

import { revalidatePath } from "next/cache";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { claimUnassignedCard } from "@/server/cards/card-claim-service";
import { UserFacingError } from "@/server/errors";

/**
 * The Server Action behind "Claim this card".
 *
 * SAME SECURITY NOTE AS EVERY OTHER `actions.ts` IN THIS APP, and it carries
 * more weight here than usual: a Server Action is a POST endpoint reachable by
 * anyone who can send the same request, not only by somebody who loaded the
 * page first. So this action re-derives the caller from a fresh
 * `getAuthenticatedContext()` and hands that context's RLS-bound client to the
 * service — it never trusts the page having rendered, and it never passes an
 * owner id, because `claim_unassigned_card` takes the owner from the JWT and
 * has no parameter for it.
 *
 * The real backstop is the database function, which applies both rate limits
 * and the `status = 'unassigned'` condition itself precisely because it is
 * directly callable and this file is not the only way to reach it
 * (20260821120000).
 *
 * WHY THE CODE COMES IN AS AN ARGUMENT RATHER THAN OFF THE URL. An action has
 * no route params — `/card/[code]` is the page's shape, not this function's.
 * It is bound by the button (`claim-card-button.tsx`), which is the same
 * pattern `revokeCardAction.bind(null, cardId)` uses on the Activity page. A
 * caller can of course pass any code they like; that is exactly why the
 * function refuses on its own terms rather than trusting this boundary.
 */
export async function claimCardAction(code: string): Promise<void> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    throw new UserFacingError("You need to be signed in to claim a card.");
  }

  const { claimed } = await claimUnassignedCard(context.supabase, code);

  if (!claimed) {
    // One message for every refusal, matching what the function returns: it
    // answers `{"ok": false}` without a reason, so there is nothing here to
    // translate and nothing to invent. "Somebody else got there first", "that
    // code isn't real" and "that card was revoked" are all true of some
    // refusals and would each be a guess about which one happened — and the
    // last of them is one §4.5 forbids saying out loud.
    throw new UserFacingError(
      "This card couldn't be claimed. If somebody just handed it to you, check the code and try again.",
    );
  }

  // The claimed card now appears in the "your cards" section of Activity, which
  // is the only surface that lists a person's own cards (Q28). Without this the
  // page would keep serving a cached list that does not include it.
  revalidatePath("/activity");
}
