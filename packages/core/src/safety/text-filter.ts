/**
 * Client-side mirror of `private.text_violation` / `private.normalize_for_text_filter`
 * (`supabase/migrations/20261009150000_table_blocked_terms_and_text_filter.sql`),
 * part of the live-map amendment's required content filter (owner decision 13,
 * `docs/architecture/2026-10-09-live-map-meetups-and-hangouts.md`).
 *
 * THIS IS A HINT, NEVER THE ENFORCEMENT POINT. The SQL function is
 * authoritative — it is what `submit_report` (and later phases' notes/bios/
 * messages) actually calls before anything is written. This module exists
 * only so a form can show "this may be rejected" while someone is still
 * typing, matching the migration's own note that the two could in principle
 * disagree (Postgres's `[:alnum:]` vs JavaScript's `\p{L}\p{N}` classify a
 * handful of Unicode characters differently) and that the SQL side is the one
 * that decides when they do.
 *
 * Exported from `packages/core/src/index.ts` alongside the package's other
 * pure, platform-independent rules (`extractContactGuess`, `haversineDistanceM`),
 * for the same reason: `report-sheet.tsx` needs it for an inline hint, and a
 * future note/bio/message form will too.
 */

export type TextFilterContext = "report_details";

export interface BlockedTerm {
  term: string;
  matchKind: "word" | "substring";
}

/**
 * Lower-cases and collapses every run of non-letter/digit characters to a
 * single space, then trims — the exact transform
 * `private.normalize_for_text_filter` applies in SQL, so "Kill-Yourself!!"
 * and "kill   yourself" both normalize to "kill yourself".
 */
export function normalizeForTextFilter(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Whether `text` contains any active blocked term for `context`. Mirrors the
 * SQL function's two match kinds: `"word"` requires the normalized term to
 * appear as whole word(s) (`" ass "` does not match inside `"class"`);
 * `"substring"` matches anywhere, including inside a longer word.
 *
 * Returns `false` for empty/whitespace-only text or an empty term list — this
 * is a hint with nothing to flag, not a refusal.
 */
export function containsBlockedTerm(
  text: string,
  terms: readonly BlockedTerm[],
): boolean {
  const normalizedText = normalizeForTextFilter(text);
  if (normalizedText === "") return false;

  return terms.some(({ term, matchKind }) => {
    const normalizedTerm = normalizeForTextFilter(term);
    if (normalizedTerm === "") return false;

    if (matchKind === "word") {
      return ` ${normalizedText} `.includes(` ${normalizedTerm} `);
    }
    return normalizedText.includes(normalizedTerm);
  });
}
