"use client";

import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { parseCsv, type CsvParseResult } from "@smartcard/core";

import { GLASS, PRIMARY_BUTTON } from "../../lib/surfaces";

/**
 * Step 1 of 4 — pick a CSV.
 *
 * THE FILE IS READ IN THE BROWSER AND NEVER UPLOADED. Nothing here posts
 * anything: `file.text()` and `parseCsv` both run on the device, and what
 * eventually crosses to the server is the array of rows the host confirms two
 * steps later (§11.2 of the import doc). So a host who changes their mind on
 * the mapping screen has sent us nothing at all, and a file with a column we
 * never import — a home address, a dietary requirement, a payment amount —
 * leaves those columns on their machine rather than on ours.
 *
 * THE SIZE CAP IS ABOUT THE BROWSER, NOT ABOUT PERMISSION. `parseCsv` is a
 * character-at-a-time loop on the main thread; a 200MB file would hang the tab
 * with no way to explain itself. This refuses at a size no real guest list
 * reaches, so the failure is a sentence rather than a frozen page. It is not a
 * security limit and is not the row cap — the row cap lives in `app_config`,
 * is enforced by the RPC, and is deliberately not knowable here.
 */

/** Comfortably past any real export; see the header for what this is for. */
const MAX_FILE_BYTES = 12 * 1024 * 1024;

export function ChooseFile({
  onParsed,
}: {
  onParsed: (fileName: string, parsed: CsvParseResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function handleFileChosen() {
    setError(null);
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      setError("That file is too large to read here. Export just the guest list, without images.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setReading(true);
    try {
      const parsed = parseCsv(await file.text());

      if (parsed.headers.length === 0) {
        setError("That file has no column headings — the first row needs to name the columns.");
        return;
      }
      if (parsed.rows.length === 0) {
        setError("That file has column headings but no guests underneath them.");
        return;
      }

      onParsed(file.name, parsed);
    } catch {
      // `file.text()` rejects on a file that vanished or cannot be decoded.
      // Nothing has been sent anywhere, so the recovery is simply to pick again.
      setError("That file couldn't be read. Try exporting it again.");
    } finally {
      setReading(false);
      // Cleared either way, so choosing the SAME file again still fires
      // `change`. Without this, a host who fixes their export and re-picks it
      // gets no response at all.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[26px] p-[17px]" style={GLASS}>
      <h2 className="text-[15px] leading-5 font-semibold">Choose your export</h2>
      <p
        className="max-w-[54ch] text-[13px] leading-[19px]"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        A CSV with one guest per row and a heading row on top. You&rsquo;ll get to check which
        column is which before anything is imported.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={() => {
          void handleFileChosen();
        }}
      />
      <button
        type="button"
        disabled={reading}
        onClick={() => inputRef.current?.click()}
        className="flex min-h-11 items-center gap-[7px] self-start rounded-full px-[18px] text-[13px] leading-[17px] font-semibold disabled:opacity-60"
        style={PRIMARY_BUTTON}
      >
        <FileUp size={15} strokeWidth={2.1} aria-hidden />
        {reading ? "Reading…" : "Choose a CSV"}
      </button>

      <p aria-live="polite" className="text-[12px] leading-[17px]" style={{ textWrap: "pretty" }}>
        {error === null ? (
          <span style={{ color: "var(--sc-text-subtle)" }}>
            The file is read on your device. Nothing is uploaded until you review it and confirm.
          </span>
        ) : (
          <span role="alert" style={{ color: "var(--sc-danger)" }}>
            {error}
          </span>
        )}
      </p>
    </div>
  );
}
