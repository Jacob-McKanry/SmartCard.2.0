"use client";

import { useMemo } from "react";
import {
  IGNORE_COLUMN,
  summariseStatusValues,
  type ColumnAssignment,
  type ColumnMapping,
  type ImportField,
  type StatusClass,
} from "@smartcard/core";

import { GLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../../lib/surfaces";
import { assignColumn, FIELD_ORDER, labelFor } from "./import-fields";

/**
 * Step 2 of 4 — say which column is which, and which statuses count as
 * attending.
 *
 * WHY THIS SCREEN EXISTS AT ALL, RATHER THAN A PARSER PER PLATFORM
 *
 * §2.3.1: Luma writes `approval_status`, Eventbrite and Partiful write
 * something else, and none of them agrees on how to spell a name column. A
 * per-platform parser would need one more release every time a platform renames
 * a heading, and would fail silently on the spreadsheet somebody keeps by hand.
 * `detectColumnMapping` guesses, and this screen is where the host corrects the
 * guess. An unrecognised column arrives as "Don't import" rather than as a
 * guess, because importing a "Dietary requirements" column as somebody's job
 * title is worse than asking.
 *
 * ONE FIELD, ONE COLUMN — ENFORCED HERE RATHER THAN EXPLAINED
 *
 * Choosing a field that another column already holds takes it from that column
 * rather than allowing both. Two columns mapped to `email` would mean the last
 * one silently wins, which is the class of bug where a host imports a guest
 * list keyed on the wrong address and finds out when the claim emails reach
 * nobody. The steal is visible — the other column drops to "Don't import" in
 * the same render — which is the part that makes it honest rather than magic.
 *
 * THE STATUS TABLE IS THE POINT OF THIS SCREEN, NOT A DETAIL
 *
 * It lists every distinct value in the status column with what we will do about
 * it and how many rows carry it, so "5 declined" is something a host reads
 * before importing rather than discovers afterwards. `declined` and `invited`
 * are shown as excluded and are NOT offered as a choice: a declined guest is
 * somebody the host turned away, and importing them would record the opposite
 * of what happened. Waitlisted IS a choice, because a host who let the waitlist
 * in at the door is describing something real.
 */

export function MapColumns({
  fileName,
  headers,
  rows,
  mapping,
  onMappingChange,
  includeApproved,
  includeWaitlisted,
  onIncludeApprovedChange,
  onIncludeWaitlistedChange,
  onBack,
  onNext,
}: {
  fileName: string;
  headers: readonly string[];
  rows: readonly Record<string, string>[];
  mapping: ColumnMapping;
  onMappingChange: (next: ColumnMapping) => void;
  includeApproved: boolean;
  includeWaitlisted: boolean;
  onIncludeApprovedChange: (next: boolean) => void;
  onIncludeWaitlistedChange: (next: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const statusValues = useMemo(() => summariseStatusValues(rows, mapping), [rows, mapping]);

  const emailMapped = Object.values(mapping).includes("email");
  const hasStatusColumn = Object.values(mapping).includes("status");
  // With no status column every row classifies `approvedLike`, so "include
  // approved" is the only switch that does anything and turning it off would
  // import nobody. Both toggles are hidden in that case rather than rendered
  // as controls that cannot help.
  const nothingSelected = hasStatusColumn && !includeApproved && !includeWaitlisted;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-[26px] p-[17px]" style={GLASS}>
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] leading-5 font-semibold">Check the columns</h2>
          <p className="truncate text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
            {fileName} · {rows.length} {rows.length === 1 ? "row" : "rows"}
          </p>
        </div>
        <p
          className="max-w-[54ch] text-[13px] leading-[19px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          We&rsquo;ve guessed from the headings. Anything set to <em>Don&rsquo;t import</em> stays
          on your machine.
        </p>

        <ul className="flex flex-col gap-2">
          {headers.map((header) => (
            <li key={header} className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] leading-[18px] font-medium" title={header}>
                  {header}
                </p>
                <SampleValue header={header} rows={rows} />
              </div>
              <FieldPicker
                header={header}
                assignment={mapping[header] ?? IGNORE_COLUMN}
                mapping={mapping}
                onMappingChange={onMappingChange}
              />
            </li>
          ))}
        </ul>
      </div>

      {hasStatusColumn ? (
        <StatusPanel
          values={statusValues}
          includeApproved={includeApproved}
          includeWaitlisted={includeWaitlisted}
          onIncludeApprovedChange={onIncludeApprovedChange}
          onIncludeWaitlistedChange={onIncludeWaitlistedChange}
        />
      ) : (
        <p
          className="max-w-[54ch] text-[12px] leading-[17px]"
          style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
        >
          No status column, so every row is treated as somebody who attended. If your file marks
          people who dropped out, map that column to <em>Going / not going</em> and we&rsquo;ll
          leave them out.
        </p>
      )}

      {!emailMapped ? (
        <p role="alert" className="text-[13px] leading-[19px]" style={{ color: "var(--sc-danger)" }}>
          Map one column to <strong>Email address</strong> to continue. It&rsquo;s how each guest
          later proves the row is theirs, so a list without it can&rsquo;t be imported.
        </p>
      ) : null}
      {nothingSelected ? (
        <p role="alert" className="text-[13px] leading-[19px]" style={{ color: "var(--sc-danger)" }}>
          Pick at least one group to import.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pb-2">
        <button
          type="button"
          onClick={onNext}
          disabled={!emailMapped || nothingSelected}
          className="min-h-11 rounded-full px-[18px] text-[13px] leading-[17px] font-semibold disabled:opacity-50"
          style={PRIMARY_BUTTON}
        >
          Review the list
        </button>
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 rounded-full px-[18px] text-[13px] leading-[17px] font-semibold"
          style={SECONDARY_BUTTON}
        >
          Choose a different file
        </button>
      </div>
    </div>
  );
}

/**
 * The first non-empty value in this column, so a host can tell two
 * similarly-named headings apart without opening the file again.
 *
 * Capped hard at 40 characters. This is the host's own guest list, so seeing a
 * value is not a disclosure — but a long free-text answer would push the picker
 * off a phone screen, and the sample is an identification aid rather than a
 * preview.
 */
function SampleValue({ header, rows }: { header: string; rows: readonly Record<string, string>[] }) {
  const sample = useMemo(() => {
    for (const row of rows) {
      const value = (row[header] ?? "").trim();
      if (value !== "") return value.length > 40 ? `${value.slice(0, 40)}…` : value;
    }
    return null;
  }, [header, rows]);

  if (sample === null) {
    return (
      <p className="text-[11px] leading-[15px]" style={{ color: "var(--sc-text-subtle)" }}>
        Empty in every row
      </p>
    );
  }
  return (
    <p className="truncate text-[11px] leading-[15px]" style={{ color: "var(--sc-text-subtle)" }}>
      e.g. {sample}
    </p>
  );
}

/**
 * One column's assignment.
 *
 * A native `<select>` deliberately: it is the one picker that is usable on a
 * phone without building a listbox, and this screen can have thirty of them.
 */
function FieldPicker({
  header,
  assignment,
  mapping,
  onMappingChange,
}: {
  header: string;
  assignment: ColumnAssignment;
  mapping: ColumnMapping;
  onMappingChange: (next: ColumnMapping) => void;
}) {
  return (
    <select
      value={assignment}
      onChange={(event) =>
        onMappingChange(assignColumn(mapping, header, event.target.value as ColumnAssignment))
      }
      // §8: thirty identical "column" selects on one screen are indistinguishable
      // to a screen reader without naming the column each one governs.
      aria-label={`What is the “${header}” column?`}
      className="min-h-11 rounded-full px-[14px] text-[13px] leading-[17px] font-medium"
      style={{ ...SECONDARY_BUTTON, maxWidth: "min(100%, 200px)" }}
    >
      <option value={IGNORE_COLUMN}>{labelFor(IGNORE_COLUMN)}</option>
      {FIELD_ORDER.map((field: ImportField) => (
        <option key={field} value={field}>
          {labelFor(field)}
        </option>
      ))}
    </select>
  );
}

const CLASS_COPY: Readonly<Record<StatusClass, { verb: string; tone: string }>> = {
  approvedLike: { verb: "Counts as attended", tone: "var(--sc-text)" },
  waitlistLike: { verb: "Waitlisted", tone: "var(--sc-text)" },
  excluded: { verb: "Left out", tone: "var(--sc-text-subtle)" },
};

function StatusPanel({
  values,
  includeApproved,
  includeWaitlisted,
  onIncludeApprovedChange,
  onIncludeWaitlistedChange,
}: {
  values: readonly { value: string; classification: StatusClass; count: number }[];
  includeApproved: boolean;
  includeWaitlisted: boolean;
  onIncludeApprovedChange: (next: boolean) => void;
  onIncludeWaitlistedChange: (next: boolean) => void;
}) {
  const hasWaitlist = values.some((v) => v.classification === "waitlistLike");

  return (
    <div className="flex flex-col gap-3 rounded-[26px] p-[17px]" style={GLASS}>
      <h2 className="text-[15px] leading-5 font-semibold">Who counts as having attended</h2>

      <ul className="flex flex-col gap-1.5">
        {values.map(({ value, classification, count }) => (
          <li key={value} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[13px] leading-[18px] font-medium">
              {value === "" ? <em style={{ color: "var(--sc-text-subtle)" }}>(blank)</em> : value}
            </span>
            <span
              className="text-[12px] leading-[17px]"
              style={{ color: CLASS_COPY[classification].tone }}
            >
              {count} · {CLASS_COPY[classification].verb}
            </span>
          </li>
        ))}
      </ul>

      <div
        className="flex flex-col gap-2 border-t pt-[11px]"
        style={{ borderTopColor: "rgba(13,18,32,.1)" }}
      >
        <Toggle
          checked={includeApproved}
          onChange={onIncludeApprovedChange}
          label="Import the people who came"
        />
        {hasWaitlist ? (
          <Toggle
            checked={includeWaitlisted}
            onChange={onIncludeWaitlistedChange}
            label="Also import the waitlist"
            hint="Only if they actually got in on the night."
          />
        ) : null}
      </div>

      <p
        className="max-w-[54ch] text-[12px] leading-[17px]"
        style={{ color: "var(--sc-text-subtle)", textWrap: "pretty" }}
      >
        People marked as declined, cancelled or never answered are always left out — they
        didn&rsquo;t attend, and recording that they did would be wrong about them.
      </p>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-[3px] size-[18px] shrink-0 accent-[var(--sc-accent)]"
      />
      <span className="flex flex-col">
        <span className="text-[13px] leading-[18px] font-medium">{label}</span>
        {hint === undefined ? null : (
          <span className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-subtle)" }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}
