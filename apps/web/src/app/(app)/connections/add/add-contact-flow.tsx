"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Keyboard, Nfc, QrCode } from "lucide-react";
import { extractContactGuess } from "@smartcard/core";
import type { GpsFixInput } from "@smartcard/types";

import { getFreshLocation } from "../../connect/lib/geolocation";
import { BadgeScanner } from "./badge-scanner";
import { NfcTap } from "./nfc-tap";
import { extractCardPhotoAction, submitManualConnectionAction } from "./actions";
import { initialAddContactActionState } from "./action-state";

/**
 * The unverified "add a contact" flow (2026-09-26,
 * docs/architecture/2026-09-26-unverified-connections.md): manual entry, OCR
 * card scan, badge QR/barcode scan, and badge NFC tap all converge on the
 * SAME form and the SAME server action, `submitManualConnectionAction`.
 *
 * WHY ONE FORM FOR FOUR INPUT MODES, RATHER THAN FOUR SEPARATE SCREENS
 *
 * None of the three scan modes claims to be authoritative — every one of
 * them only ever produces a *guess* (`extractContactGuess`, shared with the
 * server-side OCR path in `@smartcard/core`) that pre-fills this same set of
 * fields, which the person can see and correct before anything is saved.
 * Routing all four through one form is what makes that review step real
 * rather than a formality: there is exactly one place data reaches
 * `createManualConnection`, and it is always after a human looked at it.
 *
 * WHAT THIS SCREEN DELIBERATELY DOES NOT DO
 *
 * It never auto-submits from a scan result. It never claims a scan
 * "verified" anything — contrast this with `/connect`'s scan flow, which
 * this screen shares no code with beyond the camera/decoder utilities
 * (`badge-scanner.tsx`'s own header explains why). And it captures location
 * as metadata only, shown to the person and removable, never as a
 * precondition for submitting — the architecture doc's explicit "log it,
 * don't gate on it" decision.
 */

type Mode = "manual" | "scan-card" | "scan-badge" | "tap-badge";

interface ContactFields {
  firstName: string;
  lastName: string;
  companyName: string;
  companyRole: string;
  phoneNumber: string;
  email: string;
}

const EMPTY_FIELDS: ContactFields = {
  firstName: "",
  lastName: "",
  companyName: "",
  companyRole: "",
  phoneNumber: "",
  email: "",
};

const GLASS_PANEL: React.CSSProperties = {
  background: "var(--sc-glass-bg)",
  backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  border: "1px solid var(--sc-glass-bd)",
  boxShadow: "var(--sc-glass-sh)",
};

const MODES: { id: Mode; label: string; icon: typeof Keyboard }[] = [
  { id: "manual", label: "Type it in", icon: Keyboard },
  { id: "scan-card", label: "Scan a card", icon: Camera },
  { id: "scan-badge", label: "Scan a badge", icon: QrCode },
  { id: "tap-badge", label: "Tap a badge", icon: Nfc },
];

export function AddContactFlow() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("manual");
  const [fields, setFields] = useState<ContactFields>(EMPTY_FIELDS);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [location, setLocation] = useState<GpsFixInput | null>(null);
  const [locationRequested, setLocationRequested] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  const [state, formAction, pending] = useActionState(
    submitManualConnectionAction,
    initialAddContactActionState,
  );

  useEffect(() => {
    if (state.success && state.connectionId) {
      router.push(`/connections/${state.connectionId}`);
    }
    // Only re-run when a fresh submission result actually lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, state.connectionId]);

  function applyGuess(guess: { email: string | null; phoneNumber: string | null; name: string | null }) {
    setFields((prev) => {
      const [first, ...rest] = (guess.name ?? "").split(" ").filter(Boolean);
      return {
        ...prev,
        email: prev.email || (guess.email ?? ""),
        phoneNumber: prev.phoneNumber || (guess.phoneNumber ?? ""),
        firstName: prev.firstName || (first ?? ""),
        lastName: prev.lastName || rest.join(" "),
      };
    });
  }

  function handleScannedText(text: string, methodLabel: string) {
    const guess = extractContactGuess(text);
    applyGuess(guess);
    setScanNote(
      guess.email || guess.phoneNumber || guess.name
        ? `Pulled what we could find from the ${methodLabel} below — check it over before saving.`
        : `Couldn't pick anything out of the ${methodLabel} automatically. Here's the raw text, in case it helps — fill in the fields below by hand.` +
            (text.trim() ? `\n\n${text.trim().slice(0, 500)}` : ""),
    );
    setMode("manual");
  }

  async function requestLocation() {
    setLocationRequested(true);
    const result = await getFreshLocation();
    if (result.ok) {
      setLocation(result.fix);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div
        className="grid grid-cols-4 gap-1.5 rounded-[18px] p-1.5"
        style={{ background: "rgba(13,18,32,.04)" }}
        role="tablist"
        aria-label="How are you adding this contact?"
      >
        {MODES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className="flex flex-col items-center gap-1 rounded-[13px] px-1 py-2.5 text-[11px] leading-[13px] font-semibold transition-colors"
            style={
              mode === id
                ? { background: "#fff", color: "var(--sc-text)", boxShadow: "0 4px 14px -6px rgba(16,24,40,.3)" }
                : { color: "var(--sc-text-muted)" }
            }
          >
            <Icon size={17} strokeWidth={1.9} aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {mode === "scan-card" && (
        <CardScanPanel onExtracted={(text) => handleScannedText(text, "photo")} />
      )}
      {mode === "scan-badge" && (
        <div className="rounded-[24px] p-4" style={GLASS_PANEL}>
          <BadgeScanner onDecoded={(text) => handleScannedText(text, "badge code")} />
        </div>
      )}
      {mode === "tap-badge" && (
        <div className="rounded-[24px] p-4" style={GLASS_PANEL}>
          <NfcTap onRead={(text) => handleScannedText(text, "badge")} />
        </div>
      )}

      {scanNote && (
        <p
          className="whitespace-pre-wrap rounded-[16px] p-3 text-[12px] leading-[18px]"
          style={{ background: "rgba(11,96,255,.06)", color: "var(--sc-text-muted)" }}
        >
          {scanNote}
        </p>
      )}

      <form ref={formRef} action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="method" value={methodForMode(mode)} />
        {location && (
          <>
            <input type="hidden" name="latitude" value={location.latitude} />
            <input type="hidden" name="longitude" value={location.longitude} />
            <input type="hidden" name="accuracy_m" value={location.accuracyM} />
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" name="first_name" value={fields.firstName} onChange={patch(setFields, "firstName")} />
          <Field label="Last name" name="last_name" value={fields.lastName} onChange={patch(setFields, "lastName")} />
        </div>
        <Field label="Email" name="email" type="email" value={fields.email} onChange={patch(setFields, "email")} />
        <Field
          label="Phone number"
          name="phone_number"
          type="tel"
          value={fields.phoneNumber}
          onChange={patch(setFields, "phoneNumber")}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company" name="company_name" value={fields.companyName} onChange={patch(setFields, "companyName")} />
          <Field label="Role" name="company_role" value={fields.companyRole} onChange={patch(setFields, "companyRole")} />
        </div>

        <div className="flex flex-col gap-2 rounded-[16px] p-3" style={{ background: "rgba(13,18,32,.03)" }}>
          <p className="text-[12px] leading-[17px]" style={{ color: "var(--sc-text-muted)" }}>
            Where you met — logged for your own records, never required.
          </p>
          {location ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] leading-4" style={{ color: "var(--sc-text)" }}>
                Location captured (±{Math.round(location.accuracyM)}m)
              </span>
              <button
                type="button"
                onClick={() => setLocation(null)}
                className="text-[12px] leading-4 font-semibold"
                style={{ color: "var(--sc-text-muted)" }}
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void requestLocation()}
              disabled={locationRequested && location === null}
              className="self-start text-[12px] leading-4 font-semibold"
              style={{ color: "var(--sc-accent-deep)" }}
            >
              {locationRequested ? "Add my location" : "Add my current location"}
            </button>
          )}
        </div>

        {state.error && (
          <p className="text-[13px] leading-[18px]" style={{ color: "#b3261e" }} role="alert">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-1 flex min-h-11 items-center justify-center rounded-full px-5 py-3 text-[14px] leading-[18px] font-semibold text-white disabled:opacity-60"
          style={{
            background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
            boxShadow: "0 14px 30px -10px rgba(11,96,255,.55)",
          }}
        >
          {pending ? "Adding…" : "Add contact"}
        </button>
      </form>
    </div>
  );
}

function methodForMode(mode: Mode): string {
  switch (mode) {
    case "manual":
      return "manual_entry";
    case "scan-card":
      return "card_scan_ocr";
    case "scan-badge":
      return "badge_qr";
    case "tap-badge":
      return "badge_nfc";
  }
}

function patch<K extends keyof ContactFields>(
  setFields: React.Dispatch<React.SetStateAction<ContactFields>>,
  key: K,
): (value: string) => void {
  return (value) => setFields((prev) => ({ ...prev, [key]: value }));
}

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] leading-4 font-medium" style={{ color: "var(--sc-text-muted)" }}>
        {label}
      </span>
      <input
        type={type}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-[13px] px-3.5 py-2.5 text-[14px] leading-5"
        style={{ background: "rgba(255,255,255,.75)", border: "1px solid rgba(13,18,32,.1)" }}
      />
    </label>
  );
}

/**
 * The photo-capture panel for OCR. Uses a plain file input with `capture`
 * rather than a live camera preview (contrast `BadgeScanner`) because this
 * needs exactly one still photo, not a continuous decode loop — the native
 * camera app a `capture` file input opens already handles "take a photo,
 * review it, retake if you want to" better than a custom preview would.
 */
function CardScanPanel({ onExtracted }: { onExtracted: (rawText: string) => void }) {
  const [status, setStatus] = useState<"idle" | "scanning" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setStatus("scanning");
    setError(null);
    const formData = new FormData();
    formData.set("photo", file);
    const result = await extractCardPhotoAction(formData);
    if (!result.ok) {
      setStatus("error");
      setError(result.message);
      return;
    }
    setStatus("idle");
    onExtracted(result.result.rawText);
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-[24px] p-5" style={GLASS_PANEL}>
      <p className="text-center text-[13px] leading-[19px]" style={{ color: "var(--sc-text-muted)" }}>
        Take a photo of a business card or badge. We&rsquo;ll try to pull out an email, phone number, and
        name — you&rsquo;ll get to check everything before it saves.
      </p>
      <label
        className="flex min-h-11 items-center justify-center rounded-full px-5 py-3 text-[14px] leading-[18px] font-semibold text-white"
        style={{
          background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
          boxShadow: "0 14px 30px -10px rgba(11,96,255,.55)",
          cursor: status === "scanning" ? "wait" : "pointer",
        }}
      >
        {status === "scanning" ? "Reading photo…" : "Take a photo"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={status === "scanning"}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = "";
          }}
        />
      </label>
      {status === "error" && error && (
        <p className="text-[12px] leading-[17px]" style={{ color: "#b3261e" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
