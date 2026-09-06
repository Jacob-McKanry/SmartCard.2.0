import "server-only";

import { cookies } from "next/headers";

/**
 * Carries "where was this person actually trying to go" across the
 * onboarding detour — `(app)/layout.tsx`'s onboarding gate redirects a
 * brand-new account to `/onboarding` unconditionally, and a layout has no
 * way to see (or forward) the path it interrupted (see that file's own
 * header: "a layout is never told the pathname"). A short-lived cookie is
 * the one thing every step in between — the claim action, the layout
 * redirect it can't see through, `/onboarding`, and its own two exit
 * actions — can all read and write without threading a query parameter
 * through a hop that does not control its own URL.
 *
 * WHY A COOKIE AND NOT A QUERY PARAMETER ON `/onboarding`
 *
 * The layout's `redirect("/onboarding")` is a literal string with nowhere to
 * attach one — it does not know what page it interrupted, so it cannot add
 * `?next=...` to its own redirect target even if `/onboarding` were willing
 * to read one. A cookie set *before* that redirect ever happens (at the
 * moment the claim succeeds, which is the one place that genuinely knows the
 * destination) sidesteps needing the layout to know anything at all.
 *
 * WHY IT IS VALIDATED ON READ, EVEN THOUGH ONLY THIS MODULE EVER WRITES IT
 *
 * Defense in depth, matching this codebase's own "belt-and-braces" posture
 * elsewhere (`profile-service.ts`'s header): a cookie is client-held state,
 * and a stale one from a previous version of this code, a browser extension,
 * or a value edited by hand should never be redirect()'d to unexamined. Only
 * a same-origin, absolute path (`/...`) is accepted — never a full URL,
 * never a protocol-relative `//host/...`, which would be an open redirect.
 */

const COOKIE_NAME = "sc_post_signup_redirect";

/** One hour: long enough to finish onboarding, short enough that a stale cookie does not linger and surprise someone later. */
const MAX_AGE_SECONDS = 60 * 60;

/**
 * Records the destination to send this caller to once they are through the
 * mandatory onboarding gate — called from a Server Action (never from a
 * Server Component render; see `cookies()`'s own constraint), at the moment
 * an action succeeds and already holds a known-safe internal path.
 */
export async function setPostSignupRedirect(path: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, path, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
}

/**
 * The open-redirect guard, pulled out as its own pure, directly-testable
 * function rather than inlined in `consumePostSignupRedirect` — the
 * property being asserted ("this string cannot send `redirect()` somewhere
 * this cookie has no business pointing") is exactly the kind of rule that
 * belongs in a unit test, not something to trust by reading the regex once.
 *
 * Accepts a single leading slash, no scheme, no second slash immediately
 * after it (which would make `//evil.example.com/x` parse as a
 * protocol-relative URL to a different host), and no whitespace or control
 * characters that could smuggle a header or a second line into wherever
 * this string ends up rendered or logged.
 */
export function isSafeInternalRedirectPath(value: string): boolean {
  return /^\/(?!\/)[\x21-\x7e]*$/.test(value);
}

/**
 * Reads and clears the destination set by `setPostSignupRedirect`, or
 * `null` if none was set (the ordinary case — most sign-ins never call
 * `setPostSignupRedirect` at all) or it failed `isSafeInternalRedirectPath`.
 *
 * Always deletes the cookie, even when the value fails validation — a
 * malformed value is not a reason to keep re-checking it on every future
 * request.
 */
export async function consumePostSignupRedirect(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(COOKIE_NAME)?.value ?? null;
  store.delete(COOKIE_NAME);

  if (value === null) return null;
  return isSafeInternalRedirectPath(value) ? value : null;
}
