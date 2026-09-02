import "server-only";

import { recordSuppression } from "@/server/email/suppressions";
import { verifyUnsubscribeToken } from "@/server/email/unsubscribe-token";
import { serviceRoleClient } from "@/server/supabase/service-role-client";

/**
 * `/api/unsubscribe` — the public half of the do-not-mail list, alongside the
 * webhook at `/api/webhooks/resend`. `docs/architecture/2026-09-02-event-invite-email.md`
 * §5 lists "one-click unsubscribe with `List-Unsubscribe` headers" as
 * required before any bulk send, not optional polish — this route and the
 * headers the send module attaches (a later slice) are that requirement.
 *
 * BOTH METHODS DO THE SAME THING, ON PURPOSE. RFC 8058 one-click unsubscribe
 * has a mail client POST here with no user interaction, triggered by a
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header the send module
 * attaches alongside a `List-Unsubscribe: <mailto:...>, <https://...>` header
 * carrying this same URL — but a person can also just click the link in the
 * email body, which is an ordinary browser GET. Both have to work, and both
 * mean the identical thing: this address asked to stop.
 *
 * NO SIGN-IN, AND THAT IS THE POINT. Most addresses on the guest list this
 * exists for have never signed up — `event_attendee_imports`'s own header is
 * explicit that this feature holds "personal data about people who have not
 * signed up." An unsubscribe mechanism that required an account would be
 * useless to exactly the people §5's compliance requirement is about.
 * Authorization here is the signed token, not a session — see
 * `unsubscribe-token.ts`'s own header for why it needs no expiry either.
 *
 * A VALID SIGNATURE AND AN ALREADY-UNSUBSCRIBED ADDRESS SHOW THE SAME PAGE —
 * BUT AN INVALID ONE DOES NOT, UNLIKE §3.6'S CLAIM-FLOW REFUSALS ELSEWHERE
 * IN THIS CODEBASE. Those collapse every refusal reason into one answer
 * because telling a caller which check failed would let them enumerate a
 * fact about a real person (does this address hold an account, did it
 * attend this event). Suppression status carries no such fact worth hiding —
 * the recipient already knows their own address and whether mail keeps
 * arriving — so there is nothing to protect by pretending a broken link
 * worked. What there IS to protect against is telling someone "you're
 * unsubscribed" when nothing was actually recorded, which would be actively
 * false for anyone who reaches this route with a truncated or corrupted
 * URL (a real failure mode for long query strings in some mail clients) and
 * then keeps receiving mail while believing they opted out.
 */
function confirmedPage(): Response {
  return new Response(
    "<!doctype html><meta charset=\"utf-8\"><title>Unsubscribed</title>" +
      "<p>You will not receive any more guest-list invitation emails at this address.</p>",
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function invalidLinkPage(): Response {
  return new Response(
    "<!doctype html><meta charset=\"utf-8\"><title>Link not recognized</title>" +
      "<p>This unsubscribe link couldn't be verified, so nothing was changed. " +
      "It may have been cut off when it was copied — try opening it again from the original email.</p>",
    { status: 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  const sig = url.searchParams.get("sig");

  if (email === null || sig === null || !verifyUnsubscribeToken(email, sig)) {
    return invalidLinkPage();
  }

  await recordSuppression(serviceRoleClient(), email, "unsubscribed");
  return confirmedPage();
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
