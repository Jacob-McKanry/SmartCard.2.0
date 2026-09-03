/**
 * Turning somebody else's guest-list export into rows this product can import.
 *
 * WHAT THIS FILE IS, AND WHAT IT IS NOT
 *
 * It is NOT a security boundary, and nothing here is trusted by the database.
 * `public.import_event_attendees` (20260827130000) re-checks every gate that
 * matters — the caller is a verified host, they host that specific event, an
 * attestation was given, the row cap and the daily budget hold — from values
 * it reads itself. A host could bypass this module entirely and call the RPC
 * with hand-written rows, and the same gates would still hold. That is the
 * point: this decides what a CSV *means*, not who is allowed to import.
 *
 * It exists because the shape of the file is not ours. Luma writes
 * `approval_status`; Eventbrite and Partiful write something else, and none of
 * them agree on how to spell a name column. §2.3.1 of
 * `docs/architecture/2026-08-22-event-attendee-import.md` records the decision
 * that follows: no per-platform parser, one mapping screen the host confirms,
 * and a small classifier for the one column whose *values* carry a rule.
 *
 * THE ONE RULE IN HERE THAT IS NOT COSMETIC
 *
 * `declined` must never be imported. A declined guest is somebody the host
 * turned away, and importing them would record them as having attended — the
 * opposite of what happened. `invited` is the softer version of the same
 * problem: they never answered. Both are classified `excluded` below and,
 * unlike `waitlisted`, they are not offered to the host as a choice.
 *
 * Everything here is pure and dependency-free, so the interesting cases —
 * a real Luma export's headers, a status column that says `Going` instead of
 * `approved`, a guest listed three times under three ticket types — are a few
 * lines in a test rather than a file fixture.
 */

/**
 * The fields an import row can carry. `email` is the only one that matters.
 *
 * `full_name` and `status` are both here despite neither being a literal
 * `ImportRow` property — `status` drives classification (below) and
 * `full_name` drives the first/last split (`splitFullName`) rather than being
 * stored as typed. Grouped with the fields that ARE stored because a host
 * picks all of them from the same list on the mapping screen; splitting the
 * type by "gets stored verbatim" vs "gets consumed" would be a distinction
 * only this file's own internals care about.
 */
export type ImportField =
  | "email"
  | "first_name"
  | "last_name"
  | "full_name"
  | "phone_number"
  | "company_name"
  | "company_role"
  | "instagram"
  | "linkedin"
  | "status";

/** A column the host has told us to ignore, or that we could not place. */
export const IGNORE_COLUMN = "ignore" as const;

export type ColumnAssignment = ImportField | typeof IGNORE_COLUMN;

/** `{ "csv header": "email" }` — one entry per column in the uploaded file. */
export type ColumnMapping = Readonly<Record<string, ColumnAssignment>>;

/**
 * How a value in the status column is treated.
 *
 * `approvedLike` and `waitlistLike` are separately toggleable by the host
 * (§2.3.1). `excluded` is not a choice: it covers the values where the
 * platform itself recorded a refusal or a non-answer.
 */
export type StatusClass = "approvedLike" | "waitlistLike" | "excluded";

export interface ImportRow {
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  company_name: string | null;
  company_role: string | null;
  social_links: readonly { platform: string; url: string }[];
}

export interface NormalizeOptions {
  /** Import rows whose status classifies `approvedLike`. Defaults to true. */
  includeApproved?: boolean;
  /** Import rows whose status classifies `waitlistLike`. Defaults to false. */
  includeWaitlisted?: boolean;
}

export interface NormalizeResult {
  rows: readonly ImportRow[];
  /** Rows dropped, by reason. Every input row lands in exactly one bucket. */
  skipped: {
    noEmail: number;
    /** Status classified `excluded` — declined, cancelled, never answered. */
    excludedStatus: number;
    /** Status was `waitlistLike` and the host did not opt to include it. */
    waitlistNotIncluded: number;
    /** Status was `approvedLike` and the host opted out of those. */
    approvedNotIncluded: number;
    /** A later row for an email already seen; merged into the first instead. */
    duplicate: number;
  };
}

// ---------------------------------------------------------------------------
// Column detection
// ---------------------------------------------------------------------------

/**
 * Header patterns, most specific first. Order matters: `first_name` has to be
 * tried before `name`, or Luma's `first_name` column lands on the wrong field.
 *
 * These are *suggestions*. The host confirms or overrides every one of them on
 * the mapping screen, which is why an unknown column is `ignore` rather than a
 * guess — a wrong guess that silently imports a "Dietary requirements" column
 * as somebody's job title is worse than asking.
 */
const HEADER_PATTERNS: readonly (readonly [ImportField, RegExp])[] = [
  ["email", /^(e-?mail|email[_\s-]?address|guest[_\s-]?email)$/i],
  ["first_name", /^(first[_\s-]?name|given[_\s-]?name|forename)$/i],
  ["last_name", /^(last[_\s-]?name|surname|family[_\s-]?name)$/i],
  ["phone_number", /^(phone|phone[_\s-]?number|mobile|cell|telephone)$/i],
  ["instagram", /instagram/i],
  ["linkedin", /linked[_\s-]?in/i],
  ["status", /^(approval[_\s-]?status|status|rsvp[_\s-]?status|attending|order[_\s-]?status)$/i],
  // Deliberately loose, and last among the identity fields: real exports ask
  // "What company do you work for/with?" rather than naming a column
  // `company`. Anything matching is still only a suggestion.
  ["company_name", /(company|organi[sz]ation|employer|works? (for|at))/i],
  ["company_role", /(job title|^title$|role|position|occupation)/i],
];

/**
 * A single combined-name column — Luma's own `name`, or a host's own
 * "Guest Name" / "Attendee Name". Deliberately NOT in `HEADER_PATTERNS`
 * above: it is tried in a second pass, and only when nothing in the whole
 * file already claimed `first_name` — see `detectColumnMapping`'s own
 * comment for why this needs whole-file precedence rather than just
 * processing order within one pass. `name`, `first_name` and `last_name` are
 * genuinely three different columns in a real Luma export (verified against
 * the real file `attendee-import.test.ts` keeps as a fixture), and the more
 * specific pair must always win over the generic one, regardless of which
 * column comes first in the file.
 */
const FULL_NAME_PATTERN = /^(name|full[_\s-]?name|guest[_\s-]?name|attendee[_\s-]?name|contact[_\s-]?name)$/i;

/**
 * Best-guess assignment for each header in an uploaded file.
 *
 * A field is never suggested twice: the first header that matches `email`
 * wins, and a second email-ish column is left `ignore`. Two columns mapped to
 * one field would make the last one silently overwrite the first.
 *
 * `full_name` runs as a genuinely separate, later pass — not just later in
 * `HEADER_PATTERNS` — because "later in one pass" only controls order WITHIN
 * a single header's own list of candidate fields, not precedence ACROSS
 * different headers in the file. A Luma export's real header order is
 * `name, first_name, last_name, email, ...`: if `full_name` were just another
 * entry in `HEADER_PATTERNS`, the `name` column (processed first) would claim
 * `full_name` before `first_name`/`last_name` ever got a turn, even though
 * they are the better answer. Running `full_name` only after the main pass,
 * and only when it finds `first_name` still unclaimed by anything in the
 * file, makes the precedence whole-file rather than accidentally
 * order-dependent.
 */
export function detectColumnMapping(headers: readonly string[]): ColumnMapping {
  const mapping: Record<string, ColumnAssignment> = {};
  const taken = new Set<ImportField>();

  for (const header of headers) {
    const trimmed = header.trim();
    if (trimmed === "") continue;

    let assigned: ColumnAssignment = IGNORE_COLUMN;
    for (const [field, pattern] of HEADER_PATTERNS) {
      if (taken.has(field)) continue;
      if (pattern.test(trimmed)) {
        assigned = field;
        taken.add(field);
        break;
      }
    }
    mapping[header] = assigned;
  }

  if (!taken.has("first_name")) {
    for (const header of headers) {
      const trimmed = header.trim();
      if (trimmed === "" || mapping[header] !== IGNORE_COLUMN) continue;
      if (FULL_NAME_PATTERN.test(trimmed)) {
        mapping[header] = "full_name";
        break;
      }
    }
  }

  return mapping;
}

/**
 * Splits "Alex Rivera" into `{ first: "Alex", last: "Rivera" }` on the FIRST
 * space only, so "Maria Garcia Lopez" becomes `{ first: "Maria", last:
 * "Garcia Lopez" }` rather than losing the second surname. This is a split,
 * not a name parser: a title ("Dr. Maria Garcia") or a multi-word first name
 * ("Mary Ann Smith") will land wrong. Real exports vary too much — titles,
 * cultural naming orders, single names — for anything cleverer to be
 * reliably right, and §4.2 step 4 already exists for exactly this: every
 * prefilled field is individually keepable, so a wrong split is a one-time
 * guess the person corrects on their own claim screen, the same cost every
 * other guessed field in this pipeline (`company_name`'s loose header match,
 * say) already carries.
 */
export function splitFullName(raw: string | null): { first: string | null; last: string | null } {
  if (raw === null) return { first: null, last: null };
  const trimmed = raw.trim();
  if (trimmed === "") return { first: null, last: null };

  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return { first: trimmed, last: null };

  const last = trimmed.slice(spaceIndex + 1).trim();
  return { first: trimmed.slice(0, spaceIndex), last: last === "" ? null : last };
}

// ---------------------------------------------------------------------------
// Status classification
// ---------------------------------------------------------------------------

const APPROVED_LIKE = /^(approved?|confirmed?|going|yes|attending|accepted|checked[_\s-]?in|completed)$/i;
const WAITLIST_LIKE = /^(waitlist(ed)?|wait[_\s-]?list(ed)?|pending|requested|maybe)$/i;

/**
 * What a status value means. Values are matched whole, not by substring:
 * `not_going` must not classify as `going` because it contains it.
 *
 * An unrecognised value classifies `excluded`, which is the fail-closed
 * direction. If a platform invents a status we have never seen, the cost of
 * treating it as excluded is that a host notices some guests missing and tells
 * us; the cost of treating it as approved is emailing people who were turned
 * away. An empty status classifies `approvedLike` — a file with no status
 * column at all is a plain list of attendees, which is the common case for a
 * spreadsheet somebody keeps by hand.
 */
export function classifyStatusValue(raw: string | null | undefined): StatusClass {
  const value = (raw ?? "").trim();
  if (value === "") return "approvedLike";
  if (APPROVED_LIKE.test(value)) return "approvedLike";
  if (WAITLIST_LIKE.test(value)) return "waitlistLike";
  return "excluded";
}

/**
 * The distinct status values in a file, each with its classification and how
 * many rows carry it — what the mapping screen renders so a host can see that
 * "5 declined" are about to be dropped rather than discovering it afterwards.
 */
export function summariseStatusValues(
  rows: readonly Record<string, string>[],
  mapping: ColumnMapping,
): readonly { value: string; classification: StatusClass; count: number }[] {
  const statusHeader = headerFor(mapping, "status");
  if (statusHeader === null) return [];

  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = (row[statusHeader] ?? "").trim();
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, classification: classifyStatusValue(value), count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function headerFor(mapping: ColumnMapping, field: ImportField): string | null {
  for (const [header, assignment] of Object.entries(mapping)) {
    if (assignment === field) return header;
  }
  return null;
}

function cell(row: Record<string, string>, header: string | null): string | null {
  if (header === null) return null;
  const value = (row[header] ?? "").trim();
  return value === "" ? null : value;
}

/**
 * A handle or a URL, as the person typed it, turned into something storable.
 *
 * Real exports contain `@handle`, a bare handle, a full profile URL, and —
 * seen in an actual file — "I'm currently banned :/" and "N/A". Anything that
 * is plainly not an identifier is dropped rather than stored, because it will
 * be shown to the person on their claim screen as *their* social link and a
 * pre-filled field reading "don't use" is worse than a blank one.
 */
const NOT_A_HANDLE = /^(n\/?a|none|no|nope|tbd|don'?t use|dont use|-|—)$/i;

export function normaliseSocialHandle(
  platform: string,
  raw: string | null,
): { platform: string; url: string } | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value === "" || NOT_A_HANDLE.test(value)) return null;
  // A sentence is not a handle. Real files contain whole explanations in these
  // columns; a space is the cheapest reliable signal, and a URL never has one.
  if (/\s/.test(value)) return null;
  return { platform, url: value };
}

/**
 * Apply a confirmed mapping to parsed rows.
 *
 * Deduplicates on lowercased email, keeping the FIRST occurrence and filling
 * its blanks from later ones. A real Luma export lists a guest once per ticket
 * they registered, and those rows are usually identical — but when they are
 * not, the earliest row is the one the person actually filled in, and a later
 * blank must not erase it.
 */
export function normaliseImportRows(
  rows: readonly Record<string, string>[],
  mapping: ColumnMapping,
  options: NormalizeOptions = {},
): NormalizeResult {
  const includeApproved = options.includeApproved ?? true;
  const includeWaitlisted = options.includeWaitlisted ?? false;

  const emailHeader = headerFor(mapping, "email");
  const statusHeader = headerFor(mapping, "status");
  const headers = {
    first_name: headerFor(mapping, "first_name"),
    last_name: headerFor(mapping, "last_name"),
    full_name: headerFor(mapping, "full_name"),
    phone_number: headerFor(mapping, "phone_number"),
    company_name: headerFor(mapping, "company_name"),
    company_role: headerFor(mapping, "company_role"),
    instagram: headerFor(mapping, "instagram"),
    linkedin: headerFor(mapping, "linkedin"),
  };

  const skipped = {
    noEmail: 0,
    excludedStatus: 0,
    waitlistNotIncluded: 0,
    approvedNotIncluded: 0,
    duplicate: 0,
  };

  const byEmail = new Map<string, ImportRow>();

  for (const row of rows) {
    const email = cell(row, emailHeader);
    if (email === null || !email.includes("@")) {
      skipped.noEmail += 1;
      continue;
    }

    const classification = classifyStatusValue(
      statusHeader === null ? null : row[statusHeader],
    );
    if (classification === "excluded") {
      skipped.excludedStatus += 1;
      continue;
    }
    if (classification === "waitlistLike" && !includeWaitlisted) {
      skipped.waitlistNotIncluded += 1;
      continue;
    }
    if (classification === "approvedLike" && !includeApproved) {
      skipped.approvedNotIncluded += 1;
      continue;
    }

    const socials = [
      normaliseSocialHandle("instagram", cell(row, headers.instagram)),
      normaliseSocialHandle("linkedin", cell(row, headers.linkedin)),
    ].filter((link): link is { platform: string; url: string } => link !== null);

    // An explicit first_name/last_name column always wins over the split —
    // it is a stronger signal than a guessed split of a combined column, the
    // same "the more specific source wins" rule detectColumnMapping's own
    // full_name pass already applies at the column level, applied here at
    // the value level for the (rare) file that maps both.
    const fullNameSplit = splitFullName(cell(row, headers.full_name));
    const first_name = cell(row, headers.first_name) ?? fullNameSplit.first;
    const last_name = cell(row, headers.last_name) ?? fullNameSplit.last;

    const key = email.toLowerCase();
    const existing = byEmail.get(key);

    if (existing === undefined) {
      byEmail.set(key, {
        email,
        first_name,
        last_name,
        phone_number: cell(row, headers.phone_number),
        company_name: cell(row, headers.company_name),
        company_role: cell(row, headers.company_role),
        social_links: socials,
      });
      continue;
    }

    skipped.duplicate += 1;
    byEmail.set(key, {
      email: existing.email,
      first_name: existing.first_name ?? first_name,
      last_name: existing.last_name ?? last_name,
      phone_number: existing.phone_number ?? cell(row, headers.phone_number),
      company_name: existing.company_name ?? cell(row, headers.company_name),
      company_role: existing.company_role ?? cell(row, headers.company_role),
      social_links: existing.social_links.length > 0 ? existing.social_links : socials,
    });
  }

  return { rows: [...byEmail.values()], skipped };
}
