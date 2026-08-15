/**
 * The vCard a non-user downloads from a card preview.
 *
 * WHY THIS IS GENERATED SERVER-SIDE AND SERVED WITH A REAL CONTENT TYPE
 * The obvious cheaper option is a `<a download href="data:text/vcard;base64,…">`
 * built into the page, which costs no second request and no second endpoint.
 * It was rejected for the one audience this feature has: somebody who just
 * tapped a physical card with a phone. iOS Safari's handling of `data:` URL
 * downloads is unreliable for arbitrary media types, and a download that
 * silently does nothing on the majority platform is the same as not shipping
 * the feature. A route handler returning `text/vcard` works everywhere.
 *
 * The cost of that choice is paid deliberately and is written down where the
 * numbers live (20260815120000): the download is a SECOND request that
 * discloses the same details, so it consumes rate-limit budget and writes its
 * own audit row, and the seeded limits are sized on the basis that one real
 * preview costs up to two units.
 *
 * WHAT IS IN IT, AND WHAT IS DELIBERATELY NOT
 * FN, ORG, TITLE, NOTE, TEL, EMAIL. That is the whole list, fixed by the build
 * brief, and it matches the preview page field-for-field — there is no field a
 * person can get out of the file that they could not already read on screen.
 *
 *   * No PHOTO. Embedding the image would put the bytes of a private-bucket
 *     object into a file that gets forwarded, which is a materially different
 *     disclosure from a five-minute signed URL rendered once.
 *   * No URL entries. `social_links` never reaches this feature at all — see
 *     `card-preview-service.ts`'s header, and 20260809211100's reason:
 *     anything looser than the profile's own gate "would be a searchable
 *     directory of people's off-platform handles".
 *   * No N (the structured name). vCard 3.0 nominally requires it and its
 *     absence means some clients import the whole name into the first-name
 *     field. The brief named six properties and N was not among them, so this
 *     follows the brief rather than second-guessing it; adding
 *     `N:Last;First;;;` is a one-line change if the owner wants clean
 *     first/last splitting on import.
 *
 * WHY THERE IS NO LINE FOLDING
 * RFC 2426 says lines SHOULD be folded at 75 octets. This does not fold, on
 * purpose. Every mainstream consumer (iOS Contacts, Android, Google Contacts,
 * Outlook) accepts unfolded long lines, whereas folding implemented against
 * character counts instead of octets is subtly wrong for any non-ASCII name or
 * bio and produces a corrupted file rather than an ugly one. Between "slightly
 * non-conformant and correct" and "conformant-looking and occasionally
 * mangled", the first is the better failure.
 */

/** vCard 3.0 rather than 4.0: 3.0 is what every mainstream contacts app parses without argument. */
const VCARD_VERSION = "3.0";

/**
 * RFC 2426 §5 requires CRLF between properties, not LF. Some parsers tolerate
 * LF; iOS historically has not, and this file has exactly one job.
 */
const CRLF = "\r\n";

/**
 * The seven values a preview may disclose, minus the photo (which never enters
 * the file). Identical in shape to what the preview page renders, so the two
 * cannot drift into disclosing different things.
 */
export interface VCardFields {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  companyRole: string | null;
  bio: string | null;
  phoneNumber: string | null;
  email: string | null;
}

/**
 * RFC 2426 §5's escaping, in the only order that is correct.
 *
 * The backslash replacement MUST run first. Doing it after the others would
 * escape the backslashes those replacements just inserted, turning `a;b` into
 * `a\\;b` — a literal backslash followed by an unescaped separator, which is
 * a different value and, in a parser that splits on unescaped semicolons, a
 * different NUMBER of values.
 *
 * Newlines become the two-character sequence `\n` because a raw newline inside
 * a property value ends the property. A bio with a line break in it is the
 * ordinary case, not an edge case, so this is the difference between a valid
 * file and one that truncates at the first paragraph.
 */
export function escapeVCardValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Trims, and treats whitespace-only as absent. A property with an empty value is noise in a contacts app. */
function usable(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The name shown on the card, and the one place a fallback is needed.
 *
 * FN is the one property vCard 3.0 genuinely cannot do without — a file with no
 * FN imports as a blank contact in most clients. Every other property here is
 * simply omitted when the underlying column is null. `users.first_name` and
 * `last_name` are both nullable (20260809210100) and the legacy import brought
 * in real rows with patchy names, so the fallback chain is not defensive
 * programming against an impossible state: it is the state of the data.
 *
 * The chain deliberately stops before the email address. Falling back to
 * "sam@example.com" as a display name would put the address in a second place
 * in the file, which reads as a bug to the recipient and adds nothing they do
 * not already have from the EMAIL property.
 */
export function vCardDisplayName(fields: VCardFields): string {
  const parts = [usable(fields.firstName), usable(fields.lastName)].filter(
    (part): part is string => part !== null,
  );
  if (parts.length > 0) return parts.join(" ");

  const company = usable(fields.companyName);
  if (company !== null) return company;

  return "SmartCard contact";
}

/**
 * Builds the file. Pure: no clock, no environment, no I/O — so every escaping
 * rule above is testable directly rather than through an HTTP response.
 */
export function buildVCard(fields: VCardFields): string {
  const lines: string[] = ["BEGIN:VCARD", `VERSION:${VCARD_VERSION}`];

  lines.push(`FN:${escapeVCardValue(vCardDisplayName(fields))}`);

  const company = usable(fields.companyName);
  if (company !== null) lines.push(`ORG:${escapeVCardValue(company)}`);

  const role = usable(fields.companyRole);
  if (role !== null) lines.push(`TITLE:${escapeVCardValue(role)}`);

  const bio = usable(fields.bio);
  if (bio !== null) lines.push(`NOTE:${escapeVCardValue(bio)}`);

  const phone = usable(fields.phoneNumber);
  if (phone !== null) lines.push(`TEL;TYPE=CELL:${escapeVCardValue(phone)}`);

  const email = usable(fields.email);
  if (email !== null) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCardValue(email)}`);

  lines.push("END:VCARD");

  // Trailing CRLF: RFC 2426 ends the last property with one, and some parsers
  // drop a final line that has no terminator.
  return `${lines.join(CRLF)}${CRLF}`;
}

/**
 * The `filename=` for the Content-Disposition header.
 *
 * Reduced to ASCII letters, digits, dash and underscore, then bounded. This is
 * NOT cosmetic: the value is built from `users.first_name`/`last_name`, which
 * are free text a user controls, and it is being interpolated into an HTTP
 * response header. A quote or a newline in that position is header injection.
 * Stripping to a known-safe alphabet is the whole defence, and it is done here
 * rather than at the call site so there is one place to check.
 */
export function vCardFileName(fields: VCardFields): string {
  const safe = vCardDisplayName(fields)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `${safe === "" ? "smartcard-contact" : safe}.vcf`;
}

/**
 * The two HTTP responses the vCard endpoints may return, defined once so the
 * `/card/<code>/vcard` and `/c/<token>/vcard` handlers cannot diverge.
 *
 * `vCardRefusalResponse` is the download-shaped twin of `PreviewNotFound`, and
 * it exists for the same reason: `card-preview-service.ts` makes every refusal
 * the same `null`, and that is only true end to end if every refusal also
 * produces the same status, the same headers and the same body. One function,
 * no arguments, no reason.
 */
export function vCardRefusalResponse(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Same as the success case below: a refusal that is cached is a refusal
      // served again after the underlying answer changed.
      "cache-control": "no-store",
    },
  });
}

export function vCardResponse(fields: VCardFields): Response {
  return new Response(buildVCard(fields), {
    status: 200,
    headers: {
      "content-type": "text/vcard; charset=utf-8",
      // `attachment` rather than `inline`: this is a file to save, and inline
      // rendering of an unknown type is browser-dependent. The filename is
      // reduced to a safe alphabet by `vCardFileName` before it reaches a
      // header — see that function for why that is a security step and not a
      // cosmetic one.
      "content-disposition": `attachment; filename="${vCardFileName(fields)}"`,
      // NEVER cached. The contents are somebody's phone number and email, the
      // card behind them can be revoked at any moment, and the URL is
      // permanent and forwardable. A shared or CDN cache holding this would
      // keep answering after the owner had revoked the card, which is the one
      // thing their kill switch is supposed to stop.
      "cache-control": "no-store, private",
    },
  });
}
