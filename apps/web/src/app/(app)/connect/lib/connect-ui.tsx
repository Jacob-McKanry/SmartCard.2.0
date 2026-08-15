"use client";

import Link from "next/link";
import { X } from "lucide-react";

/**
 * The shared chrome for the Connect screens — `docs/design/DESIGN.md` §5
 * (Buttons) and §6 (Connect), ported from the `Connect` block of
 * `SmartCard 2.0.dc.html`.
 *
 * The presenter, the scanner and the success payoff all need the same three
 * button treatments and the same outcome panel, and two of those are places
 * where a well-meaning divergence would be a security bug rather than an
 * inconsistency. Hence one module.
 *
 * `QuietOutcome` IS THE IMPORTANT ONE — READ ITS COMMENT BEFORE CHANGING IT.
 */

export const PRIMARY_BUTTON: React.CSSProperties = {
  background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
  color: "#fff",
  boxShadow: "0 14px 30px -10px rgba(11,96,255,.55)",
};

export const SECONDARY_BUTTON: React.CSSProperties = {
  background: "rgba(255,255,255,.7)",
  border: "1px solid rgba(13,18,32,.1)",
  color: "var(--sc-text)",
};

export const TERTIARY_BUTTON: React.CSSProperties = {
  background: "transparent",
  color: "var(--sc-text-muted)",
};

/** Shared geometry for all three: §5's pill, 14px padding, 14px semibold label. */
export const BUTTON_CLASS =
  "flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-4 py-[13px] text-[14px] leading-[18px] font-semibold";

export function ConnectLink({
  href,
  style,
  children,
}: {
  href: string;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={BUTTON_CLASS} style={style}>
      {children}
    </Link>
  );
}

export function ConnectButton({
  onClick,
  style,
  children,
}: {
  onClick: () => void;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={BUTTON_CLASS} style={style}>
      {children}
    </button>
  );
}

/** The "getting your location…" / "setting up your code…" line. Calm on purpose. */
export function StatusLine({ message }: { message: string }) {
  return (
    <p
      className="py-6 text-center text-[14px] leading-5"
      style={{ color: "var(--sc-text-muted)" }}
      role="status"
    >
      {message}
    </p>
  );
}

/**
 * Every way a connect attempt can end badly, drawn identically.
 *
 * WHY THERE IS EXACTLY ONE OF THESE, AND WHY IT SHOWS ONE LINE
 *
 * §4.2 step 7 is a security requirement, not a copy guideline: a refusal must
 * reveal nothing — no distance, no radius, no reason code, nothing confirming
 * that a session, a card or a person exists. The API enforces that by
 * returning the same sentence for many different reasons (see
 * `packages/core/src/connect/user-messages.ts`, and the tests that pin it).
 *
 * A screen can undo that enforcement without touching the server, which is
 * the failure mode this component exists to prevent. Three ways it could:
 *
 *  1. **Two visual treatments.** If "too far away" drew a red panel and
 *     "expired code" drew a grey one, the shared message would stop being
 *     shared — the *pixels* would carry the reason code the string withholds.
 *     So there is one treatment, and `message` is the only input.
 *  2. **Anything added around the message.** No "(we couldn't verify your
 *     distance)" subtitle, no error code in the corner, no icon that varies
 *     by cause. `message` is rendered verbatim and nothing is composed onto
 *     it.
 *  3. **Timing or affordance differences.** The retry button is the same
 *     button with the same label in every case.
 *
 * DESIGN.md §6 says it plainly — "Failure is deliberately quiet and generic
 * … one line" — and §7 adds the reason: don't let the visual design oversell
 * what the copy is intentionally withholding.
 *
 * The device-permission messages (`locationDenialMessage`,
 * `cameraDenialMessage`) also render through here. Those are longer and more
 * specific, and that is allowed: they describe the caller's own phone and are
 * produced before any request is sent, so there is nothing about the other
 * party in them. See `../lib/geolocation.ts`'s header for that distinction.
 */
export function QuietOutcome({
  message,
  onRetry,
  retryLabel = "Try again",
}: {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-5">
      <span
        className="flex size-[72px] items-center justify-center rounded-full"
        style={{
          background: "rgba(13,18,32,.05)",
          border: "1px solid rgba(13,18,32,.08)",
          animation: "sc-rise .4s ease both",
        }}
        aria-hidden
      >
        <X size={30} strokeWidth={2} color="var(--sc-text-subtle)" />
      </span>
      <p
        role="status"
        className="max-w-[34ch] text-center text-[15px] leading-[21px] font-medium"
        style={{ color: "var(--sc-text-muted)", textWrap: "pretty" }}
      >
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-11 rounded-full px-[22px] py-3 text-[13px] leading-[17px] font-semibold"
        style={SECONDARY_BUTTON}
      >
        {retryLabel}
      </button>
    </div>
  );
}
