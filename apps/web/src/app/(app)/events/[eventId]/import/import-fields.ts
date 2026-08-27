import {
  IGNORE_COLUMN,
  type ColumnAssignment,
  type ColumnMapping,
  type ImportField,
} from "@smartcard/core";

/**
 * The mapping screen's own copy and its one piece of logic.
 *
 * WHAT EACH IMPORT FIELD IS CALLED ON SCREEN
 *
 * Separate from `@smartcard/core`'s `ImportField` union on purpose. That
 * package ships to mobile and holds no copy, and these strings are copy: they
 * are what a host reads while deciding whether the column headed "What is your
 * job title?" is really the one that should become somebody's role. Keeping
 * them here means the web wording can change without touching a module the
 * phone imports.
 *
 * `email` leads because it is the only mapping the import cannot proceed
 * without — it is the identity every other field hangs off, and the thing a
 * person later claims against.
 */
export const FIELD_LABELS: Readonly<Record<ImportField, string>> = {
  email: "Email address",
  first_name: "First name",
  last_name: "Last name",
  phone_number: "Phone number",
  company_name: "Company",
  company_role: "Job title",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  status: "Going / not going",
};

/** Picker order. `email` first; the rest roughly as they appear on a profile. */
export const FIELD_ORDER: readonly ImportField[] = [
  "email",
  "first_name",
  "last_name",
  "phone_number",
  "company_name",
  "company_role",
  "instagram",
  "linkedin",
  "status",
];

/** The label for any assignment, including "don't import this column". */
export function labelFor(assignment: ColumnAssignment): string {
  return assignment === IGNORE_COLUMN ? "Don't import" : FIELD_LABELS[assignment];
}

/**
 * Point one column at one field, taking that field off whichever column held it.
 *
 * THE STEAL IS THE WHOLE FUNCTION, AND IT IS NOT A CONVENIENCE
 *
 * `normaliseImportRows` finds a field's column with the FIRST match in
 * `Object.entries(mapping)`. So two columns mapped to `email` does not error and
 * does not merge — one of them silently wins, chosen by object key order, which
 * is the kind of thing that holds through testing and breaks on a file whose
 * columns happen to be the other way round. The failure it produces is a guest
 * list keyed on the wrong address, discovered when the claim emails reach
 * nobody. Making the assignment exclusive here means that state is never
 * reachable from the UI at all.
 *
 * `detectColumnMapping` already guarantees this for its own guesses; this keeps
 * it true after a host edits one.
 *
 * Choosing "don't import" steals nothing — several columns may sit at
 * `IGNORE_COLUMN` at once, which is the normal state of most of a real export.
 */
export function assignColumn(
  mapping: ColumnMapping,
  header: string,
  chosen: ColumnAssignment,
): ColumnMapping {
  const next: Record<string, ColumnAssignment> = { ...mapping };

  if (chosen !== IGNORE_COLUMN) {
    for (const [other, held] of Object.entries(next)) {
      if (other !== header && held === chosen) next[other] = IGNORE_COLUMN;
    }
  }
  next[header] = chosen;
  return next;
}
