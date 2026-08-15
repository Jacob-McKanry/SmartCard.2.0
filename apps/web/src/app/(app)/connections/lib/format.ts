import type { VerificationMethod } from "@smartcard/types";

/**
 * Small, pure display-formatting helpers shared by the connections list and
 * the meeting-record detail page. Factored out for the same reason
 * `apps/web/src/app/connect/lib/` exists: no React, no browser API, no
 * database — safe to unit test directly and safe to reuse wherever a
 * connection or a meeting needs to be described in words.
 *
 * These deliberately do NOT decide who may see the values passed in — every
 * caller here already got its data through an RLS-bound query, so by the time
 * a name or a date reaches these functions, the access-control question is
 * already answered. This module only answers "how do I say it".
 */

/**
 * Formats a person's full name from `users.first_name` / `users.last_name`,
 * with a fallback for a row that has neither set (both nullable — §2.1).
 *
 * Mirrors the fallback *shape* of `initialsFor()` in
 * `apps/web/src/app/profile/page.tsx` (empty parts collapse, don't throw),
 * without importing from that route — that helper returns initials for the
 * viewer's own avatar; this one needs a full name string for someone else's,
 * so duplicating the few lines was clearer than reaching across features for
 * a two-line function.
 */
export function displayName(person: { first_name: string | null; last_name: string | null }): string {
  const first = person.first_name?.trim() ?? "";
  const last = person.last_name?.trim() ?? "";
  const full = `${first} ${last}`.trim();
  return full !== "" ? full : "This connection";
}

/** Same fallback logic as `displayName`, but for an `Avatar` fallback glyph. */
export function initialsFor(person: { first_name: string | null; last_name: string | null }): string {
  const first = person.first_name?.trim().charAt(0) ?? "";
  const last = person.last_name?.trim().charAt(0) ?? "";
  const combined = `${first}${last}`.toUpperCase();
  return combined !== "" ? combined : "•";
}

/**
 * The plain-language label for `meetings.verification_method` (§2.4). Kept
 * here rather than inlined at each call site so the two values only ever get
 * described one way across the list and detail views.
 */
export function verificationMethodLabel(method: VerificationMethod): string {
  switch (method) {
    case "qr_gps":
      return "QR code, verified by location";
    case "nfc_card":
      return "NFC card tap";
  }
}

/**
 * `formatOccurredAt` USED TO LIVE HERE. USE `<LocalTimestamp>` INSTEAD.
 *
 * It formatted `meetings.occurred_at` with `toLocaleString("en-US", …)` and no
 * `timeZone`. Both pages in this feature are Server Components, so that read
 * the *server's* zone — UTC on Vercel — and a meeting made at 10:00 PM US
 * Central was shown back to the two people who were there as "4:00 AM".
 *
 * The zone a meeting time must be printed in is the reader's, and only the
 * browser knows it, so it cannot be decided in a pure string helper like the
 * ones above. `@/components/local-timestamp` renders it instead; its header
 * explains how, and why locale stays pinned to `en-US`.
 */
