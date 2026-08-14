"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { PresenterFlow } from "./present/presenter-flow";
import { ScannerFlow } from "./scan/scanner-flow";

type Mode = "present" | "scan";

/**
 * `/connect` used to be two separate destinations — "Show my code" and "Scan
 * a code" — each its own page, each requiring a full navigation to switch
 * between. Per the task brief for this pass, that's now one screen with a
 * toggle: tap it once, it flips between showing your code and scanning
 * someone else's, no page load in between.
 *
 * WHY THIS IS A THIN SWITCH, NOT A REWRITE OF EITHER FLOW
 *
 * `PresenterFlow` and `ScannerFlow` are unchanged — same GPS gate, same QR
 * rotation, same camera handling, same `/api/connect/*` calls, same tests.
 * All this component does is decide which one is mounted. Switching modes
 * unmounts the other, and both already clean up correctly on unmount
 * (`presenter-flow.tsx` releases the wake lock and cancels its heartbeat
 * timer; `scanner-flow.tsx` stops the camera stream) — that existing
 * cleanup is what makes a live toggle safe instead of a resource leak.
 *
 * WHY THE TOGGLE STATE ISN'T IN THE URL
 *
 * Neither mode has anything worth linking to or reloading into directly — a
 * QR code and a camera stream are both request-scoped and useless replayed
 * from history. Local component state is the whole state that matters here.
 */
export function ConnectToggle() {
  const [mode, setMode] = useState<Mode>("present");

  return (
    <div className="flex flex-col items-center gap-6">
      <div
        role="tablist"
        aria-label="Show my code or scan a code"
        className="inline-flex rounded-md border border-border bg-muted p-1"
      >
        <ToggleButton label="Show my code" active={mode === "present"} onClick={() => setMode("present")} />
        <ToggleButton label="Scan a code" active={mode === "scan"} onClick={() => setMode("scan")} />
      </div>

      <p className="text-sm text-muted-foreground">
        {mode === "present"
          ? "Have the other person scan this with SmartCard."
          : "Point your camera at the code they're showing."}
      </p>

      {mode === "present" ? <PresenterFlow /> : <ScannerFlow />}
    </div>
  );
}

function ToggleButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-sm px-4 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
