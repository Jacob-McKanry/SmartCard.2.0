/**
 * The claim-invite email's content — pure, no I/O, no secrets, so it can be
 * unit-tested without a fake Resend client or a database.
 *
 * THE COPY FOLLOWS §2.3.1's RULE, NOT §4.3's HEADING
 * `docs/architecture/2026-08-22-event-attendee-import.md` §2.3.1 is explicit
 * that this system has no path to "verified attended" from CSV data — only
 * "the host says this person was on the list" — and names the exact copy
 * this email must use: "Jacob added you to the guest list for Founders
 * Dinner", never "You attended Founders Dinner". `claim-review.tsx` and
 * `claim-teaser.tsx` already enforce the identical rule with their own tests
 * asserting "attended" never appears; this file's own test does the same for
 * the email.
 *
 * WHY THE MAILING ADDRESS IS A REQUIRED PARAMETER, NOT READ FROM ENV HERE
 * This module has no I/O by design (see above) — `env.ts`'s
 * `emailMailingAddress()` is read once by the caller and passed in, the same
 * shape every other pure builder in this codebase takes its inputs.
 */
export interface ClaimEmailInput {
  /** The recipient's own first name from the CSV, when the host supplied one. */
  recipientFirstName: string | null;
  /** The host's first name. Falls back to a generic phrase when absent (nullable in `users`). */
  hostFirstName: string | null;
  eventTitle: string;
  /** Absolute URL to `/claim/[token]`. */
  claimUrl: string;
  /** Absolute URL to `/api/unsubscribe`, already signed — see `unsubscribe-token.ts`. */
  unsubscribeUrl: string;
  /** CAN-SPAM's required physical address, one line. */
  mailingAddress: string;
}

export interface ClaimEmailContent {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildClaimEmail(input: ClaimEmailInput): ClaimEmailContent {
  const host = input.hostFirstName?.trim() || "Your host";
  const greeting = input.recipientFirstName?.trim() ? `Hi ${input.recipientFirstName.trim()},` : "Hi,";
  const subject = `${host} added you to the guest list for ${input.eventTitle}`;

  const text = [
    greeting,
    "",
    `${host} added you to the guest list for ${input.eventTitle} on SmartCard.`,
    "Claim your profile to see the event and connect with people you meet there:",
    input.claimUrl,
    "",
    "If this wasn't meant for you, you can ignore this email — nothing happens until the link above is opened and confirmed.",
    "",
    "---",
    input.mailingAddress,
    `Don't want these emails? Unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, sans-serif; color: #0d1220; max-width: 480px; margin: 0 auto; padding: 24px;">
    <p>${escapeHtml(greeting)}</p>
    <p>${escapeHtml(host)} added you to the guest list for <strong>${escapeHtml(input.eventTitle)}</strong> on SmartCard.</p>
    <p>Claim your profile to see the event and connect with people you meet there:</p>
    <p><a href="${escapeHtml(input.claimUrl)}" style="display: inline-block; padding: 12px 20px; background: #0b60ff; color: #fff; border-radius: 999px; text-decoration: none;">View your invite</a></p>
    <p style="color: #6b7280; font-size: 13px;">If this wasn't meant for you, you can ignore this email — nothing happens until the link above is opened and confirmed.</p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
    <p style="color: #9ca3af; font-size: 12px;">
      ${escapeHtml(input.mailingAddress)}<br />
      <a href="${escapeHtml(input.unsubscribeUrl)}" style="color: #9ca3af;">Unsubscribe</a>
    </p>
  </body>
</html>`;

  return { subject, html, text };
}
