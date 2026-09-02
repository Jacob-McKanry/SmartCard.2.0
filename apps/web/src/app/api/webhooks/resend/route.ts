import "server-only";

import { Webhook } from "svix";

import { resendWebhookSecret } from "@/server/env";
import { recordSuppression } from "@/server/email/suppressions";
import { serviceRoleClient } from "@/server/supabase/service-role-client";

/**
 * `/api/webhooks/resend` — the bounce/complaint half of the do-not-mail list,
 * `docs/architecture/2026-09-02-event-invite-email.md` §1.
 *
 * SIGNATURE FIRST, NEVER INTERPRET UNVERIFIED DATA — the same rule
 * `qr-token.ts`'s own header states for its own token, applied here to a
 * request instead of a QR code. Resend delivers webhooks through Svix, which
 * signs the RAW request body with HMAC-SHA256; `req.text()` is read once and
 * handed to `Webhook.verify()` before this route parses a single field out of
 * it. Passing anything re-serialized (a `.json()` object stringified back)
 * would compute a signature over different bytes than Resend actually signed
 * and fail every request, or — if verification were skipped and JSON parsed
 * first — accept a forged body wholesale.
 *
 * NOBODY BUT RESEND CAN REACH `recordSuppression` THROUGH THIS ROUTE.
 * `Webhook.verify` throws on a missing, malformed or mismatched signature,
 * caught below and turned into a 401 with no further processing. There is no
 * fallback path that trusts an unverified body "just this once" — a route
 * that could be tricked into recording a fake bounce could equally be
 * tricked into silently swallowing a real complaint by never being called
 * for it, and either one is a hole in the one list every future send has to
 * trust.
 *
 * WHY THIS DOES NOT ALSO HANDLE `email.delivered` / `email.opened` / etc.
 * Only `email.bounced` and `email.complained` change whether we may send —
 * everything else Resend reports is telemetry a later slice (§3.9-shaped
 * aggregates on the import status screen) can read from Resend's own
 * dashboard or API rather than this route accumulating counters nothing
 * reads yet. Adding cases here is cheap when something needs them; keeping
 * this route narrow while nothing does is the point.
 */

interface ResendWebhookEvent {
  type: string;
  data: {
    email_id?: string;
    to?: readonly string[];
  };
}

function firstRecipient(event: ResendWebhookEvent): string | null {
  const to = event.data.to;
  return Array.isArray(to) && typeof to[0] === "string" && to[0].length > 0 ? to[0] : null;
}

export async function POST(req: Request): Promise<Response> {
  const payload = await req.text();

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (svixId === null || svixTimestamp === null || svixSignature === null) {
    return new Response("missing signature headers", { status: 401 });
  }

  let event: ResendWebhookEvent;
  try {
    // `svix`'s own .d.ts declares `Webhook.verify()` as returning `undefined`
    // — a typing bug upstream (the implementation returns the verified,
    // parsed payload; that is the method's entire purpose). Routed through
    // `unknown` rather than asserted directly, so this cast survives the
    // declared type without pretending the two overlap.
    event = new Webhook(resendWebhookSecret()).verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as unknown as ResendWebhookEvent;
  } catch (error) {
    console.error("[webhooks/resend] signature verification failed", { error });
    return new Response("invalid signature", { status: 401 });
  }

  if (event.type !== "email.bounced" && event.type !== "email.complained") {
    // Verified, understood, and deliberately ignored — see the header.
    return new Response(null, { status: 200 });
  }

  const recipient = firstRecipient(event);
  if (recipient === null) {
    // A verified event Resend itself did not attach a recipient to. Nothing
    // to suppress, and not a signature problem, so this is a 200 (Resend
    // should not retry a message that will never carry a `to`) logged for a
    // human to notice rather than a 4xx/5xx that triggers Resend's retry.
    console.error("[webhooks/resend] verified event carried no recipient", { type: event.type });
    return new Response(null, { status: 200 });
  }

  await recordSuppression(
    serviceRoleClient(),
    recipient,
    event.type === "email.bounced" ? "bounced" : "complained",
    event.data.email_id,
  );

  return new Response(null, { status: 200 });
}
