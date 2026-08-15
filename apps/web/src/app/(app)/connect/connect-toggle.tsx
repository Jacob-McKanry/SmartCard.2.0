"use client";

import { useState } from "react";

import type { PayoffViewer } from "./connected-payoff";
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
 * `PresenterFlow` and `ScannerFlow` are unchanged in behaviour — same GPS
 * gate, same QR rotation, same camera handling, same `/api/connect/*` calls,
 * same tests. All this component does is decide which one is mounted.
 * Switching modes unmounts the other, and both already clean up correctly on
 * unmount (`presenter-flow.tsx` releases the wake lock and cancels its
 * heartbeat timer; `scanner-flow.tsx` stops the camera stream) — that
 * existing cleanup is what makes a live toggle safe instead of a resource
 * leak.
 *
 * WHY UNMOUNTING ON SWITCH IS ALSO THE RIGHT PRIVACY BEHAVIOUR
 *
 * Flipping to "Show my code" tears the camera down rather than leaving it
 * running behind a hidden element, and flipping to "Scan" ends the live QR
 * session's heartbeat. Neither should keep consuming a sensor, or keep a
 * connectable session alive, while the person is looking at the other one.
 *
 * WHY THE TOGGLE STATE ISN'T IN THE URL
 *
 * Neither mode has anything worth linking to or reloading into directly — a
 * QR code and a camera stream are both request-scoped and useless replayed
 * from history. Local component state is the whole state that matters here.
 *
 * `viewer` is the signed-in person's own initials and photo, resolved on the
 * server in `page.tsx` and threaded through to both flows for the success
 * payoff's two-disc flourish. It is display data about the caller, never sent
 * anywhere; see `connected-payoff.tsx`.
 */
export function ConnectToggle({ viewer }: { viewer: PayoffViewer }) {
  const [mode, setMode] = useState<Mode>("present");

  return (
    <div className="flex w-full flex-col items-center gap-5">
      {/* §6's glass segmented toggle. */}
      <div
        role="tablist"
        aria-label="Show my code or scan a code"
        className="flex gap-0.5 rounded-full p-1"
        style={{
          background: "rgba(255,255,255,.6)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,.8)",
        }}
      >
        <ToggleButton
          label="Show my code"
          active={mode === "present"}
          onClick={() => setMode("present")}
        />
        <ToggleButton label="Scan a code" active={mode === "scan"} onClick={() => setMode("scan")} />
      </div>

      {mode === "present" ? <PresenterFlow viewer={viewer} /> : <ScannerFlow viewer={viewer} />}
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
      className="min-h-11 rounded-full px-5 py-[9px] text-[13px] leading-4 font-semibold transition-all duration-300"
      style={{
        background: active ? "#ffffff" : "transparent",
        color: active ? "var(--sc-text)" : "var(--sc-text-subtle)",
        boxShadow: active ? "0 2px 8px rgba(16,24,40,.12)" : "none",
        transitionTimingFunction: "var(--sc-ease-glide)",
      }}
    >
      {label}
    </button>
  );
}
