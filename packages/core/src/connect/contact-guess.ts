/**
 * Modest, never-trusted contact-field guessing from raw text — shared by
 * every input mode of the unverified "add a contact" flow (2026-09-26,
 * docs/architecture/2026-09-26-unverified-connections.md): OCR'd card text
 * (`apps/web/src/server/connect/card-ocr.ts`), a decoded badge QR/barcode
 * payload, and a scanned NFC badge's text/URL record.
 *
 * Platform-independent and I/O-free on purpose (§1.3): the same three
 * regressible guesses should not be re-derived slightly differently on the
 * server (OCR) and in the browser (QR/NFC decoding), and none of this needs
 * anything a browser or a server has that the other doesn't.
 *
 * WHY THIS NEVER "PARSES" INTO STRUCTURED FIELDS WITH CONFIDENCE
 *
 * An email regex, a phone regex, and a single best-effort human-name guess.
 * Company name and role are deliberately left for the person to type in
 * after reading the raw text themselves — a badge, a card, and OCR'd text
 * all have unpredictable layouts, and a guess presented as more confident
 * than it is would violate this feature's own stated posture (see the
 * architecture doc, and `claim-review.tsx`'s precedent for CSV-imported
 * fields): a guess is always shown to the person and always editable before
 * anything is saved, never silently trusted.
 */

export interface ContactGuess {
  email: string | null;
  phoneNumber: string | null;
  name: string | null;
}

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/**
 * A loose phone pattern: 7+ digits total, allowing the punctuation a printed
 * card or badge actually uses (spaces, dots, dashes, parens, a leading +).
 * Deliberately permissive — a false positive here is a pre-filled field the
 * person can clear, while a false negative is a field they have to type in
 * anyway; the asymmetry favors catching more candidates.
 */
const PHONE_PATTERN = /(\+?\d[\d\s.\-()]{6,}\d)/;

/**
 * Common company-name words. A line containing one of these is treated as a
 * business name rather than a person's, since "Acme Inc" is otherwise
 * indistinguishable from "Jane Smith" by capitalization alone — both are
 * 2-4 capitalized words with no digits.
 */
const COMPANY_WORDS = new Set(
  [
    "inc",
    "inc.",
    "llc",
    "llc.",
    "ltd",
    "ltd.",
    "corp",
    "corp.",
    "co",
    "co.",
    "group",
    "solutions",
    "partners",
    "studio",
    "studios",
    "company",
    "holdings",
    "ventures",
    "labs",
  ].map((w) => w.toLowerCase()),
);

/** A line that looks like "Firstname Lastname" — 2-4 capitalized words, no digits, @ symbol, or company-name word. */
function looksLikeAName(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "" || /[\d@]/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  if (words.some((word) => COMPANY_WORDS.has(word.toLowerCase()))) return false;
  return words.every((word) => /^[A-Z][a-zA-Z'.-]*$/.test(word));
}

/** Pulls the modest, non-confident guesses described in the file header out of raw text. */
export function extractContactGuess(rawText: string): ContactGuess {
  const email = rawText.match(EMAIL_PATTERN)?.[0] ?? null;
  const phoneMatch = rawText.match(PHONE_PATTERN)?.[0]?.trim() ?? null;
  const name = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => looksLikeAName(line));

  return {
    email,
    phoneNumber: phoneMatch,
    name: name ?? null,
  };
}
