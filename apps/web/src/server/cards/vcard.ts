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
 * FN, ORG, TITLE, NOTE, TEL, EMAIL, PHOTO, URL. The invariant is
 * one-directional and is the one to preserve: there is no field a person can
 * get out of the file that they could not already read on the preview page.
 * The file may say less than the page. It must never say more.
 *
 *   * PHOTO was added 2026-08-15 and the paragraph here used to argue against
 *     it: "embedding the image would put the bytes of a private-bucket object
 *     into a file that gets forwarded, which is a materially different
 *     disclosure from a five-minute signed URL rendered once". The owner asked
 *     for it, and the argument does not survive contact with what the page
 *     already does — the same visitor is already being shown the same image,
 *     and a person who wants to keep it can right-click it. What the file adds
 *     is durability, not access, and that is the same trade already accepted for
 *     the phone number and the email, which are equally forwardable and rather
 *     more sensitive. `card-preview-service.ts`'s `loadPhotoBytes` carries the
 *     rest of the reasoning: why the bytes are embedded rather than referenced
 *     by URI (a signed URL expires in five minutes; a saved contact does not),
 *     and why there is a size cap.
 *   * URL entries were added 2026-08-28, reversing the paragraph that used to
 *     stand here. It argued the omission was fine because "nobody asked for
 *     them" — the owner then did, and the argument was never that disclosing
 *     them was wrong, only that nobody had requested the two-line change. One
 *     `URL` property per link, in the same order the preview page's tiles show
 *     them, capped the same way the preview already caps them
 *     (`MAX_PREVIEW_SOCIAL_LINKS`, `card-preview-service.ts`) — so this file
 *     still cannot say more than the page, it just no longer says less on
 *     purpose.
 *   * N (the structured name) was ADDED 2026-08-28, and the paragraph it
 *     replaces was wrong in a way worth recording, because it is the whole
 *     bug. It read: "No N. vCard 3.0 nominally requires it and its absence
 *     means some clients import the whole name into the first-name field. The
 *     brief named six properties and N was not among them, so this follows the
 *     brief rather than second-guessing it; adding `N:Last;First;;;` is a
 *     one-line change if the owner wants clean first/last splitting on
 *     import."
 *
 *     Two things in that were mistaken. "Nominally requires" understates it —
 *     RFC 2426 §3.1.2 lists N as one of the properties a vCard 3.0 MUST
 *     include. And the consequence is far worse than untidy first/last
 *     splitting: iOS Contacts builds a person's displayed name from N, not
 *     from FN, so with N absent there is NO person name at all. iOS then
 *     treats the card as an ORGANISATION contact and shows ORG in the name
 *     position — or, with no ORG either, saves a contact with no name.
 *
 *     Reported by the owner as "the name isn't saving — it saves as
 *     'SmartCard' for each person", which is exactly this: their own
 *     `company_name` is the literal string "SmartCard", so their card
 *     displayed as their employer. Measured against the live database rather
 *     than reasoned about: of 315 active cardholders, 135 would import
 *     showing their company instead of their name, 180 with no name
 *     whatsoever, and 4 (the ones tested) as the literal word "SmartCard".
 *     The failure was total — every card, every person — and it was invisible
 *     from this side because the file we generate looked fine.
 *
 * WHY THERE IS NO LINE FOLDING, EXCEPT FOR THE PHOTO
 * RFC 2426 says lines SHOULD be folded at 75 octets. The text properties do not
 * fold, on purpose. Every mainstream consumer (iOS Contacts, Android, Google
 * Contacts, Outlook) accepts unfolded long lines, whereas folding implemented
 * against character counts instead of octets is subtly wrong for any non-ASCII
 * name or bio and produces a corrupted file rather than an ugly one. Between
 * "slightly non-conformant and correct" and "conformant-looking and
 * occasionally mangled", the first is the better failure.
 *
 * PHOTO is folded, and that is consistent with the paragraph above rather than
 * an exception to it. The objection to folding is that a character count is not
 * an octet count — which is true of a name or a bio and is exactly false of
 * base64, whose alphabet is ASCII, one octet per character, by definition. So
 * the failure mode that argument is about cannot occur here. Meanwhile the
 * property being folded is not a long line, it is a ~230,000-character one, and
 * that is the size at which "every mainstream consumer accepts it" stops being
 * something anybody has actually tested.
 */

/** vCard 3.0 rather than 4.0: 3.0 is what every mainstream contacts app parses without argument. */
const VCARD_VERSION = "3.0";

/**
 * RFC 2426 §5 requires CRLF between properties, not LF. Some parsers tolerate
 * LF; iOS historically has not, and this file has exactly one job.
 */
const CRLF = "\r\n";

/**
 * RFC 2426 §2.6's fold width: a content line SHOULD be no longer than 75
 * octets, excluding the line break. Continuation lines begin with a single
 * space, which the parser strips before concatenating — so a continuation
 * carries 74 payload characters, not 75. Getting that off by one corrupts
 * base64 into a different image or into nothing.
 */
const FOLD_WIDTH = 75;

/**
 * The values a preview may disclose, in the shape the file needs them.
 * Structurally satisfied by `CardPreview`, so the page and the file cannot
 * drift into disclosing different things.
 */
export interface VCardFields {
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  companyRole: string | null;
  bio: string | null;
  phoneNumber: string | null;
  email: string | null;
  /**
   * The embedded image, or null/absent for no PHOTO property. Optional so that
   * every existing caller and test constructing a `VCardFields` by hand keeps
   * compiling and keeps meaning "no photo".
   */
  photo?: VCardPhoto | null;
  /**
   * Off-platform links, each becoming one `URL` property, in order. Optional
   * and defaulting to none, for the same reason `photo` is: every existing
   * caller and fixture predating this field keeps compiling and keeps
   * meaning "no links". Only `url` is read — `CardPreview.socialLinks`
   * (`id`, `platform`, `url`) structurally satisfies this, so no caller needs
   * to convert its shape.
   */
  socialLinks?: readonly { url: string }[];
}

/** Base64 image bytes plus the `TYPE=` token naming their format. */
export interface VCardPhoto {
  /** e.g. `WEBP`. Comes from a fixed allowlist in `card-preview-service.ts`. */
  vCardType: string;
  /** Standard base64, unfolded — `buildVCard` folds it. */
  base64: string;
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
 * `usable`'s counterpart for the photo: an absent, empty or malformed one omits
 * the property rather than writing `PHOTO;ENCODING=b;TYPE=:` — a property with
 * no value, which some importers treat as a corrupt card rather than ignoring.
 *
 * The base64 alphabet is checked here rather than trusted from the caller. This
 * is defence in depth against exactly one thing: a value containing a CRLF would
 * terminate the property and let the rest of it be parsed as new vCard
 * properties — an injection into the file's structure. `card-preview-service.ts`
 * produces this string from `Buffer.toString("base64")` and can only ever
 * produce a clean one, so this check should never fire; it is here because the
 * cost is one regex and the failure it prevents is a file that says something
 * nobody wrote.
 */
function usablePhoto(photo: VCardPhoto | null | undefined): VCardPhoto | null {
  if (photo === null || photo === undefined) return null;
  if (!/^[A-Za-z0-9]+$/.test(photo.vCardType)) return null;
  if (photo.base64 === "" || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.base64)) return null;
  return photo;
}

/**
 * RFC 2426 §2.6 folding, applied only to the PHOTO line — see the file header
 * for why folding is right there and wrong for the text properties.
 *
 * The first line carries `FOLD_WIDTH` characters. Every continuation begins
 * with the single space the spec requires and therefore carries one fewer.
 */
export function foldVCardLine(line: string): string {
  if (line.length <= FOLD_WIDTH) return line;

  const parts: string[] = [line.slice(0, FOLD_WIDTH)];
  for (let i = FOLD_WIDTH; i < line.length; i += FOLD_WIDTH - 1) {
    parts.push(` ${line.slice(i, i + FOLD_WIDTH - 1)}`);
  }
  return parts.join(CRLF);
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
 * The structured name — `N:Family;Given;Additional;Prefixes;Suffixes` — which
 * is what a contacts app actually files a person under.
 *
 * WHY THIS IS BUILT FROM THE COLUMNS AND NOT FROM `vCardDisplayName`
 * The display name has a fallback chain that ends at a company and then at a
 * placeholder. Neither of those is a *name*, and putting one in the family-name
 * slot would assert that "Northwind" is somebody's surname. So this reads
 * `firstName`/`lastName` directly, and when there is no human name to state it
 * emits the empty structured name `N:;;;;` rather than inventing one.
 *
 * WHAT AN EMPTY `N` MEANS, AND WHY IT IS THE RIGHT ANSWER RATHER THAN A GAP
 * `N:;;;;` beside `FN:Northwind` and `ORG:Northwind` is precisely how vCard
 * represents an organisational contact, and it is what iOS renders as a company
 * rather than a person. For a row that genuinely has no first or last name —
 * 180 of the 315 live cardholders, mostly from the legacy import — "we do not
 * know this person's name" is the true statement, and the org (or the FN
 * placeholder) carrying the label is the honest outcome. The bug being fixed
 * here is that EVERY card looked like that, including the 135 that have a
 * perfectly good name sitting in the columns.
 *
 * ALL FOUR SEMICOLONS ARE ALWAYS PRESENT. A five-component property with
 * components missing is not "shorter", it is malformed, and a parser that
 * counts fields would mis-assign what it does find.
 *
 * THE COMPONENT SEPARATORS ARE NOT ESCAPED; THE VALUES INSIDE THEM ARE. Each
 * part goes through `escapeVCardValue` on its own — so a surname containing a
 * semicolon or comma is escaped and cannot add a component — and the four
 * structural `;` are then written literally. Escaping the joined string, or
 * joining unescaped parts, would each be wrong in the opposite direction.
 */
export function vCardStructuredName(fields: VCardFields): string {
  const family = usable(fields.lastName);
  const given = usable(fields.firstName);

  const escape = (part: string | null): string =>
    part === null ? "" : escapeVCardValue(part);

  // family;given;additional;prefixes;suffixes — the last three are values this
  // schema has no column for, and an absent value is an empty component.
  return `${escape(family)};${escape(given)};;;`;
}

/**
 * Builds the file. Pure: no clock, no environment, no I/O — so every escaping
 * rule above is testable directly rather than through an HTTP response.
 */
export function buildVCard(fields: VCardFields): string {
  const lines: string[] = ["BEGIN:VCARD", `VERSION:${VCARD_VERSION}`];

  // N BEFORE FN, which is the order essentially every real vCard uses and the
  // order RFC 2426's own examples show. The spec does not require it, but a
  // parser that reads the first name-ish property it recognises should meet
  // the structured one first.
  lines.push(`N:${vCardStructuredName(fields)}`);
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

  // One URL per link, in the order given — the same order the preview page's
  // tiles render them in, and already capped there (`MAX_PREVIEW_SOCIAL_LINKS`)
  // before it ever reaches this function. `escapeVCardValue` runs on every one:
  // a URL is free text a user typed into a link field, not a value this app
  // generated, so it gets no less scrutiny than the bio does.
  for (const link of fields.socialLinks ?? []) {
    const url = usable(link.url);
    if (url !== null) lines.push(`URL:${escapeVCardValue(url)}`);
  }

  const photo = usablePhoto(fields.photo);
  if (photo !== null) {
    // NOT run through `escapeVCardValue`. That function is for text values, and
    // base64's alphabet (A–Z a–z 0–9 + / =) contains none of the characters it
    // escapes — but it would escape nothing and cost a pass over a quarter of a
    // megabyte, and more importantly calling it here would suggest the value is
    // text a user typed. It is not: `vCardType` comes from a fixed allowlist and
    // `base64` is machine-generated, which is what makes it safe to interpolate
    // into a property parameter at all.
    lines.push(foldVCardLine(`PHOTO;ENCODING=b;TYPE=${photo.vCardType}:${photo.base64}`));
  }

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
