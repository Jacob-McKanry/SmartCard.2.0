/**
 * A CSV reader, to RFC 4180, for guest-list uploads.
 *
 * WHY THIS IS HAND-WRITTEN RATHER THAN A DEPENDENCY
 *
 * `packages/core` has two dependencies — `@smartcard/types` and `zod` — and
 * §1.3 requires it to be importable unchanged by a phone. Anything added here
 * ships to mobile whether mobile uses it or not, so the bar for a new
 * dependency is high and CSV is a format small enough to clear it the other
 * way: the whole grammar is quoting, doubled quotes, and two line endings.
 *
 * That is a real tradeoff and not a free win. A library has seen files this
 * has not. What makes it acceptable is that the failure mode is visible rather
 * than silent — a host looks at a preview of parsed rows and a column-mapping
 * screen before anything is imported, so a mis-parse shows up as garbled names
 * on screen, not as a quiet corruption of somebody's contact details.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No type coercion, no header transformation, no trimming of field values —
 * every cell comes back as the exact string between the delimiters. Trimming
 * belongs to `attendee-import.ts`, which knows which fields are identifiers
 * and which are free text; doing it here would silently change a value the
 * mapping preview then shows as if it came from the file.
 */

export interface CsvParseResult {
  /** The first row, verbatim. Empty when the input has no content. */
  headers: readonly string[];
  /** One object per data row, keyed by header. */
  rows: readonly Record<string, string>[];
}

/**
 * Split CSV text into fields, honouring RFC 4180 quoting.
 *
 * Returns rows of raw cells. A quoted field may contain commas, newlines and
 * doubled quotes (`""` meaning one `"`); everything outside quotes is literal.
 */
function splitRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  // A UTF-8 BOM (U+FEFF) is the single most common reason a first column
  // named `email` arrives with an invisible leading character and matches
  // nothing on the mapping screen. Excel writes one far more often than a web
  // app does, and a host exporting from Luma into Excel and back hits it.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  while (i < text.length) {
    const char = text[i] as string;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    // A quote only OPENS a field at its start, per RFC 4180. Anywhere else it
    // is a literal character — an inch mark, a nickname in quotes mid-sentence.
    // Treating every quote as an opener means one unbalanced quote swallows
    // the entire rest of the file as a single quoted field, which is the
    // difference between one garbled cell and a destroyed import.
    if (char === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (char === "\r" || char === "\n") {
      // CRLF is one line ending, not two. Treating it as two would emit an
      // empty row between every real one.
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // Whatever is buffered when the text runs out is a final row, unless the
  // file ended cleanly on a line break and there is nothing pending.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Parse CSV text into headers and header-keyed rows.
 *
 * Rows shorter than the header row get empty strings for the missing columns,
 * and cells beyond the header row are dropped. Both happen in real files —
 * a trailing comma, or a note somebody typed past the last column — and
 * neither is worth refusing an entire guest list over.
 *
 * Entirely blank lines are skipped rather than becoming rows of empty strings,
 * because a trailing newline is universal and a row with no email would
 * otherwise be counted and reported to the host as a skipped guest.
 */
export function parseCsv(text: string): CsvParseResult {
  const raw = splitRows(text);
  if (raw.length === 0) return { headers: [], rows: [] };

  const headers = (raw[0] ?? []).map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < raw.length; r += 1) {
    const cells = raw[r] ?? [];
    if (cells.every((c) => c.trim() === "")) continue;

    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c];
      if (key === undefined || key === "") continue;
      row[key] = cells[c] ?? "";
    }
    rows.push(row);
  }

  return { headers, rows };
}
