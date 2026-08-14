"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import type { EligiblePhoto } from "./eligible-photos";

/** How many uploads run at once. Small on purpose — this is 148 files totaling ~7MB, not a bulk pipeline. */
const CONCURRENCY = 5;

type RowStatus =
  | { kind: "waiting" }
  | { kind: "not-selected" }
  | { kind: "size-mismatch"; expected: number; actual: number }
  | { kind: "uploading" }
  | { kind: "done"; httpStatus: number }
  | { kind: "failed"; httpStatus: number | null; message: string };

interface RowState {
  photo: EligiblePhoto;
  file: File | null;
  status: RowStatus;
}

/**
 * Does the actual upload work, entirely in the browser. See `page.tsx`'s
 * header for the security reasoning; the short version is that this
 * component has no more privilege than the temporary, user-id-scoped RLS
 * policy currently open on `storage.objects` grants to the public anon key
 * — which is the same key every other page already ships to every visitor.
 *
 * WHY A FOLDER PICKER (`webkitdirectory`) INSTEAD OF A ZIP UPLOAD
 *
 * Unzipping in the browser means shipping a zip-parsing library to a page
 * that exists for one afternoon. `webkitdirectory` needs no dependency —
 * every file's `webkitRelativePath` already carries its position under
 * whatever folder was picked, which is exactly what's needed to match
 * against `eligible-photos.ts`'s `relativePath` (a simple `endsWith` check,
 * robust to picking the `profiles` folder itself or any parent of it).
 */
export function PhotoBackfillUploader({
  rows: initialRows,
  supabaseUrl,
  anonKey,
}: {
  rows: readonly EligiblePhoto[];
  supabaseUrl: string;
  anonKey: string;
}) {
  const [rows, setRows] = useState<RowState[]>(() =>
    initialRows.map((photo) => ({ photo, file: null, status: { kind: "waiting" } })),
  );
  const [running, setRunning] = useState(false);

  const summary = useMemo(() => {
    const done = rows.filter((r) => r.status.kind === "done").length;
    const failed = rows.filter(
      (r) => r.status.kind === "failed" || r.status.kind === "size-mismatch",
    ).length;
    const matched = rows.filter((r) => r.file !== null).length;
    return { done, failed, matched, total: rows.length };
  }, [rows]);

  function handleFolderSelected(fileList: FileList | null) {
    if (fileList === null) return;
    const files = Array.from(fileList);

    setRows((prev) =>
      prev.map((row) => {
        const match = files.find((f) => {
          const relPath = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
          return relPath.endsWith(row.photo.relativePath);
        });
        if (match === undefined) {
          return { ...row, file: null, status: { kind: "not-selected" } };
        }
        if (match.size !== row.photo.expectedBytes) {
          return {
            ...row,
            file: match,
            status: { kind: "size-mismatch", expected: row.photo.expectedBytes, actual: match.size },
          };
        }
        return { ...row, file: match, status: { kind: "waiting" } };
      }),
    );
  }

  async function uploadOne(row: RowState): Promise<RowStatus> {
    if (row.file === null) return row.status;
    const url = `${supabaseUrl}/storage/v1/object/profile-photos/${row.photo.userId}/${row.photo.filename}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "image/webp",
          "x-upsert": "true",
        },
        body: row.file,
      });
      if (response.ok) {
        return { kind: "done", httpStatus: response.status };
      }
      const body = await response.text().catch(() => "");
      return { kind: "failed", httpStatus: response.status, message: body.slice(0, 200) };
    } catch (error) {
      return {
        kind: "failed",
        httpStatus: null,
        message: error instanceof Error ? error.message : "Network error",
      };
    }
  }

  async function runUploads() {
    setRunning(true);
    const uploadable = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.file !== null && row.status.kind === "waiting");

    let cursor = 0;
    async function worker() {
      while (cursor < uploadable.length) {
        const item = uploadable[cursor];
        cursor += 1;
        if (item === undefined) continue;
        const { row, index } = item;
        setRows((prev) =>
          prev.map((r, i) => (i === index ? { ...r, status: { kind: "uploading" } } : r)),
        );
        const status = await uploadOne(row);
        setRows((prev) => prev.map((r, i) => (i === index ? { ...r, status } : r)));
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    setRunning(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="folder-input">
          Select the <code>profiles</code> folder (or its parent)
        </label>
        {/* webkitdirectory is unstandardized but supported by every browser this pilot targets (Chrome/Safari/Edge). */}
        <input
          id="folder-input"
          type="file"
          // @ts-expect-error -- webkitdirectory has no React/DOM type, but every target browser honors it.
          webkitdirectory=""
          multiple
          onChange={(e) => handleFolderSelected(e.target.files)}
          className="text-sm"
        />
      </div>

      <p className="text-sm text-muted-foreground">
        Matched {summary.matched} / {summary.total} expected files.{" "}
        {summary.done > 0 && `${summary.done} uploaded. `}
        {summary.failed > 0 && `${summary.failed} failed or size-mismatched.`}
      </p>

      <Button
        onClick={() => void runUploads()}
        disabled={running || summary.matched === 0}
        className="self-start"
      >
        {running ? "Uploading…" : `Upload ${summary.matched} matched photos`}
      </Button>

      <div className="max-h-96 overflow-y-auto rounded-md border border-border text-xs">
        <table className="w-full">
          <tbody>
            {rows.map((row) => (
              <tr key={row.photo.relativePath} className="border-b border-border last:border-0">
                <td className="p-1.5 font-mono">{row.photo.userId.slice(0, 8)}…</td>
                <td className="p-1.5 truncate">{row.photo.filename}</td>
                <td className="p-1.5">{describeStatus(row.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function describeStatus(status: RowStatus): string {
  switch (status.kind) {
    case "waiting":
      return "matched, waiting";
    case "not-selected":
      return "not found in selection";
    case "size-mismatch":
      return `size mismatch (expected ${status.expected}, got ${status.actual})`;
    case "uploading":
      return "uploading…";
    case "done":
      return `uploaded (${status.httpStatus})`;
    case "failed":
      return `failed${status.httpStatus ? ` (${status.httpStatus})` : ""}: ${status.message}`;
  }
}
