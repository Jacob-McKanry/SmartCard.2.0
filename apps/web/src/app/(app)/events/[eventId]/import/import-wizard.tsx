"use client";

import { useMemo, useState } from "react";
import {
  detectColumnMapping,
  normaliseImportRows,
  type ColumnMapping,
  type CsvParseResult,
} from "@smartcard/core";
import type { AttendeeImportSummary } from "@smartcard/types";

import { ChooseFile } from "./choose-file";
import { ImportDone } from "./import-done";
import { MapColumns } from "./map-columns";
import { ReviewAndAttest } from "./review-and-attest";
import type { AttendeeImportActionState } from "./action-state";

/**
 * The four import steps, as one component holding one parse.
 *
 * WHY THE STATE LIVES HERE RATHER THAN IN FOUR ROUTES
 *
 * The CSV is read and parsed in the browser and has to survive from the mapping
 * screen to the review screen to the submit. Splitting the steps across routes
 * would mean handing the parsed rows between them, and every way of doing that
 * — re-parsing per step, session storage, a server round trip — makes the
 * preview and the write two separate interpretations of the same bytes. §11.2
 * of `docs/architecture/2026-08-22-event-attendee-import.md` rules that out:
 * the host attests to a list, so the list they looked at has to be the array
 * that gets sent. One parse, one array, one component.
 *
 * NOTHING HERE IS A SECURITY BOUNDARY, INCLUDING THE STEP ORDER. A host who
 * never loads this page can post to `importAttendeesAction` directly, and the
 * five gates inside `public.import_event_attendees` are unchanged by that. The
 * step order exists so a host understands what they are about to do, not to
 * stop anybody doing it.
 *
 * WHY THE PARSED FILE IS DROPPED ON "IMPORT ANOTHER"
 *
 * `reset()` clears the file, the mapping and the toggles rather than returning
 * to the mapping screen with the previous list still loaded. A second file is a
 * second attestation about a different set of people, and leaving the old rows
 * in memory behind a fresh-looking screen is how somebody re-imports the first
 * file by accident.
 */

interface LoadedFile {
  name: string;
  parsed: CsvParseResult;
}

export function ImportWizard({ eventId }: { eventId: string }) {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [includeApproved, setIncludeApproved] = useState(true);
  // Off by default, and that default is a decision rather than an oversight: a
  // waitlisted guest is somebody who *might* have got in, and the host is the
  // only one who knows whether they did.
  const [includeWaitlisted, setIncludeWaitlisted] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [summary, setSummary] = useState<AttendeeImportSummary | null>(null);

  // Recomputed from the rows, the mapping and the toggles — never stored. A
  // cached copy is how the review screen ends up describing a mapping the host
  // has since changed.
  const result = useMemo(() => {
    if (file === null) return null;
    return normaliseImportRows(file.parsed.rows, mapping, {
      includeApproved,
      includeWaitlisted,
    });
  }, [file, mapping, includeApproved, includeWaitlisted]);

  function handleParsed(name: string, parsed: CsvParseResult) {
    setFile({ name, parsed });
    setMapping(detectColumnMapping(parsed.headers));
    setIncludeApproved(true);
    setIncludeWaitlisted(false);
    setReviewing(false);
  }

  function reset() {
    setFile(null);
    setMapping({});
    setIncludeApproved(true);
    setIncludeWaitlisted(false);
    setReviewing(false);
    setSummary(null);
  }

  function handleDone(state: AttendeeImportActionState) {
    if (state.summary !== undefined) setSummary(state.summary);
  }

  if (summary !== null) {
    return <ImportDone eventId={eventId} summary={summary} onImportAnother={reset} />;
  }

  if (file === null || result === null) {
    return <ChooseFile onParsed={handleParsed} />;
  }

  if (reviewing) {
    return (
      <ReviewAndAttest
        eventId={eventId}
        fileName={file.name}
        result={result}
        onBack={() => setReviewing(false)}
        onDone={handleDone}
      />
    );
  }

  return (
    <MapColumns
      fileName={file.name}
      headers={file.parsed.headers}
      rows={file.parsed.rows}
      mapping={mapping}
      onMappingChange={setMapping}
      includeApproved={includeApproved}
      includeWaitlisted={includeWaitlisted}
      onIncludeApprovedChange={setIncludeApproved}
      onIncludeWaitlistedChange={setIncludeWaitlisted}
      onBack={reset}
      onNext={() => setReviewing(true)}
    />
  );
}
