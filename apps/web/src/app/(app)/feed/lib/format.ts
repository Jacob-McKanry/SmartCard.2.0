import type { VerificationMethod } from "@smartcard/types";

/**
 * Small, pure display-formatting helpers for the meeting feed (README build
 * order item 4).
 *
 * These are near-duplicates of the equivalents in
 * `apps/web/src/app/connections/lib/format.ts`. That is deliberate, not an
 * oversight: the connections feature's own `initialsFor` comment already
 * establishes the precedent this follows — "duplicating the few lines was
 * clearer than reaching across features for a two-line function" — and the
 * feed's build task is explicit that `apps/web/src/app/connections/**` gets
 * no changes beyond the one link into `/connections/[connectionId]`, which a
 * cross-feature import would put in tension with the moment either file
 * needed a feed-only tweak. Same reasoning as that file, applied the same
 * way here.
 */

/** Formats a person's full name from `users.first_name` / `users.last_name`. */
export function displayName(person: { first_name: string | null; last_name: string | null }): string {
  const first = person.first_name?.trim() ?? "";
  const last = person.last_name?.trim() ?? "";
  const full = `${first} ${last}`.trim();
  return full !== "" ? full : "Someone";
}

/** Same fallback logic as `displayName`, but for an `Avatar` fallback glyph. */
export function initialsFor(person: { first_name: string | null; last_name: string | null }): string {
  const first = person.first_name?.trim().charAt(0) ?? "";
  const last = person.last_name?.trim().charAt(0) ?? "";
  const combined = `${first}${last}`.toUpperCase();
  return combined !== "" ? combined : "•";
}

/** The plain-language label for `meetings.verification_method` (§2.4). */
export function verificationMethodLabel(method: VerificationMethod): string {
  switch (method) {
    case "qr_gps":
      return "QR code, verified by location";
    case "nfc_card":
      return "NFC card tap";
  }
}

/**
 * `formatOccurredAt` USED TO LIVE HERE TOO, AND CARRIED THE SAME BUG.
 *
 * This is the case the header above got wrong: the duplication was fine while
 * these were wording helpers, but the timestamp helper was a *rule* — print an
 * instant on the reader's clock — and four copies of a rule meant four copies
 * of the same defect. Each copy called `toLocaleString("en-US", …)` with no
 * `timeZone` inside a Server Component, so every meeting in the feed was
 * stamped in the Vercel runtime's UTC rather than the reader's zone.
 *
 * Use `<LocalTimestamp>` from `@/components/local-timestamp`, which is shared
 * across all of them for that reason; its header explains the mechanism.
 */
