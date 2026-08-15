"use server";

import { redirect } from "next/navigation";

import { getAuthenticatedContext } from "@/server/auth/current-user";
import { softDeleteOwnAccount } from "@/server/account/account-service";

/**
 * The Settings screen's one Server Action: delete this account.
 *
 * SAME SECURITY NOTE AS EVERY OTHER `actions.ts` IN THIS APP, and it is not
 * boilerplate here. A Server Action is a POST endpoint reachable by anyone who
 * can send the same request, so the identity is re-derived from a fresh
 * `getAuthenticatedContext()` rather than trusted from the page — and then
 * discarded, because the RPC does not take a subject. There is nothing this
 * action could pass that would delete somebody else's account: the account is
 * whoever the verified JWT says it is, decided inside the database.
 *
 * WHY IT REDIRECTS TO THE LOGOUT ROUTE RATHER THAN BACK TO SETTINGS
 *
 * Because the session is now attached to an account that cannot hold one. If
 * the person stayed signed in, their very next navigation would hit
 * `ensureUser()`, throw `UserNotActiveError`, and land them on the auth failure
 * screen — a dead end reached by accident rather than an ending. Signing them
 * out is also the thing that actually clears the Kinde cookie, which is the
 * only piece of this that lives outside our database.
 *
 * `/api/auth/logout` is the path the SDK's own `LogoutLink` renders (asserted in
 * `settings-honesty.test.tsx` against the SDK rather than hardcoded), so this
 * redirect and the Sign out button end up in exactly the same place.
 *
 * FAIL CLOSED — the ordering below is the whole of it. `redirect()` signals by
 * throwing and is therefore the LAST statement, outside any `try`. If
 * `softDeleteOwnAccount` throws — a refusal, a dropped connection, an answer
 * this app does not recognise — the throw propagates, the redirect never runs,
 * and the person is not signed out. Nothing in the database changed either: the
 * RPC is one transaction, so a failure rolled all four tables back. The outcome
 * of a failed delete is an error and a live account, never a signed-out person
 * wondering which of the two it was.
 */
export async function deleteAccountAction(): Promise<void> {
  const context = await getAuthenticatedContext();
  if (context === null) {
    throw new Error("You need to be signed in to do that.");
  }

  const outcome = await softDeleteOwnAccount(context.supabase);

  // Logged rather than shown. The person is about to be signed out and has
  // already been told, in the confirmation, exactly what this does — a count of
  // their own cancelled events on the way out is noise to them and useful to
  // whoever is reading the logs after a restore request.
  console.info("[account] soft delete committed", {
    userId: context.userId,
    alreadyDeleted: outcome.alreadyDeleted,
    cardsRevoked: outcome.cardsRevoked,
    eventsCancelled: outcome.eventsCancelled,
    sessionsRevoked: outcome.sessionsRevoked,
  });

  redirect("/api/auth/logout");
}
