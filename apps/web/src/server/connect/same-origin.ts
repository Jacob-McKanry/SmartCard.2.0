/**
 * The cross-site request check every `/api/connect/*` route runs before it
 * does anything else.
 *
 * WHY THIS EXISTS, AND WHY "SameSite=Lax ALREADY COVERS IT" IS NOT THE ANSWER
 *
 * These routes are authenticated by a COOKIE. `getAuthenticatedContext()` reads
 * the Kinde session out of `@kinde-oss/kinde-auth-nextjs`'s HttpOnly cookie
 * (plaintext, not encrypted — the token is JWKS-verified on read instead),
 * which the browser attaches to a request because of where it is going,
 * not because of who caused it to be sent. That is the definition of a CSRF
 * surface: a page on `evil.example` can cause the victim's browser to POST here
 * with the victim's session, and every check downstream — the JWKS
 * verification, `ensureUser`, the minted token, RLS — passes, because the
 * victim really is signed in. Nothing downstream is looking at who *asked*.
 *
 * What that buys an attacker is not hypothetical, and it is worse here than on
 * a typical app. `POST /api/connect/nfc/redeem` carries one field, a card code.
 * An attacker holding any card code who can get a signed-in victim to load a
 * page they control could forge a connection between that victim and the card's
 * owner with no tap, no scan, and no proximity of any kind — i.e. the exact
 * thing CLAUDE.md's non-negotiable product rule says cannot happen ("a
 * connection can only be created through NFC or a live, GPS-verified QR scan").
 * A connection is also not a neutral row: it opens the `users` read policy's
 * `are_connected` branch between two people, so a forged edge is a forged
 * profile-visibility grant.
 *
 * The Kinde cookie really is `SameSite=Lax` (checked in the installed SDK, not
 * assumed: `{sameSite:"lax",httpOnly:true,secure:NODE_ENV==="production"}`), so
 * a modern browser will not attach it to a cross-site POST, and this attack
 * does not work today. This module exists anyway, for three reasons:
 *
 *   1. It is somebody else's default. `SameSite=Lax` is a property of a
 *      third-party SDK's cookie options and of browser behaviour, neither of
 *      which this repository controls or tests. A dependency bump that changed
 *      it to `none` — the setting an SDK reaches for the moment anything needs
 *      to work in an embedded context — would silently re-open the product's
 *      single most important invariant, with nothing here to notice.
 *   2. Fail closed is the house rule. CLAUDE.md: "if a check can't be
 *      completed... reject the action rather than let it through." The connect
 *      path fails closed on a missing GPS fix, a missing config row, and a
 *      broken rate limiter. It should not be the one place that relies on an
 *      implicit default.
 *   3. `readAuthenticatedRequest` never looked at `Content-Type`. It reads the
 *      body as text and JSON-parses it, so a `text/plain` cross-site POST — a
 *      CORS "simple request", which does not get a preflight to stop it — is
 *      shaped exactly like a legitimate call. That removes the accidental
 *      second layer people often assume a JSON API has.
 *
 * WHAT IT CHECKS, IN THIS ORDER
 *
 *   `Sec-Fetch-Site` first, when present. This is the browser's own statement
 *   about the relationship between the initiator and the target, it is a
 *   forbidden header (page JavaScript cannot set or remove it), and it is the
 *   only signal that distinguishes `same-origin` from `same-site`. That
 *   distinction matters concretely here: the app is deployed on
 *   `*.vercel.app`, where "same site" includes every other tenant's
 *   deployment — so treating `same-site` as trusted would trust strangers.
 *   It is rejected.
 *
 *   `Origin` second, when present and `Sec-Fetch-Site` was not. Compared
 *   against the origin the request was actually addressed to, rebuilt from the
 *   forwarded host/proto headers the platform sets, so it stays correct on a
 *   Vercel preview deployment and on a custom domain without a config value to
 *   keep in sync.
 *
 * WHY A REQUEST CARRYING NEITHER HEADER IS ALLOWED THROUGH
 *
 * This is the one deliberate hole and it is not a browser hole. Both headers
 * are forbidden header names: script cannot suppress them, and every browser
 * that can reach this app sends at least one of them on a cross-site POST. A
 * request with neither is not a browser doing something cross-site — it is a
 * non-browser client, which is what §5.2's mobile path will be: a bearer token
 * on an HTTP request with no cookie and therefore no CSRF surface at all,
 * because there is no ambient credential for a third party to borrow. Hard
 * -requiring `Origin` would break that client for no security gain.
 *
 * WHAT THIS IS NOT. It is not authentication and it is not authorization —
 * both of those still happen, unchanged, immediately after. It only refuses to
 * let a third-party page be the thing that asks.
 */

/** The verdict, so a caller can log the specific reason without echoing it to the user. */
export type OriginCheckResult =
  | { ok: true }
  | { ok: false; reason: "cross_site_fetch" | "foreign_origin" };

/**
 * Rebuilds the origin this request was addressed to.
 *
 * Prefers the forwarded headers over `request.url` because behind Vercel's
 * proxy the URL a Route Handler sees is not necessarily the URL the browser
 * typed, and it is the browser's view that `Origin` will be compared against.
 * Returns null when there is no host header at all, which the caller treats as
 * "cannot answer" — and therefore, per the fail-closed rule, as a refusal
 * whenever an `Origin` was supplied to compare with.
 */
export function requestOrigin(headers: Headers, fallbackUrl: string): string | null {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host !== null && host.trim() !== "") {
    // `x-forwarded-proto` can be a comma-separated chain; the left-most entry
    // is the scheme the client actually used.
    const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    return `${proto === undefined || proto === "" ? "https" : proto}://${host.trim()}`;
  }

  try {
    return new URL(fallbackUrl).origin;
  } catch {
    return null;
  }
}

/**
 * @param headers The incoming request's headers.
 * @param url The incoming request's URL, used only as a fallback for rebuilding
 *   the target origin when no host header is present.
 */
export function checkSameOrigin(headers: Headers, url: string): OriginCheckResult {
  const fetchSite = headers.get("sec-fetch-site");

  if (fetchSite !== null && fetchSite.trim() !== "") {
    // `none` is a user-initiated navigation (typed URL, bookmark) — not a
    // third-party page causing the request, so it is not cross-site. Everything
    // that is not `same-origin` or `none` — i.e. `cross-site` and `same-site` —
    // is refused. See the header on why `same-site` is not good enough on a
    // shared apex like `*.vercel.app`.
    const site = fetchSite.trim().toLowerCase();
    return site === "same-origin" || site === "none"
      ? { ok: true }
      : { ok: false, reason: "cross_site_fetch" };
  }

  const origin = headers.get("origin");
  if (origin === null || origin.trim() === "" || origin.trim().toLowerCase() === "null") {
    // No browser signal at all. A non-browser client — see the header for why
    // that is deliberately not a refusal.
    return { ok: true };
  }

  const expected = requestOrigin(headers, url);
  if (expected === null) {
    // An `Origin` was supplied and we cannot work out what to compare it
    // against. Refuse rather than guess: this is precisely the "a check could
    // not be completed" case CLAUDE.md says to fail closed on.
    return { ok: false, reason: "foreign_origin" };
  }

  return origin.trim() === expected
    ? { ok: true }
    : { ok: false, reason: "foreign_origin" };
}
