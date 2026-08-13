/**
 * The URL the presenter's QR code encodes, and the parser that recognises it
 * on the scanning side.
 *
 * §4.2 step 2 (original doc) specifies `https://smartcard.app/c/<token>` as
 * the content; §9 Q15 later confirms the production domain is actually
 * `smartcard.tech`. Rather than hardcode either literal — or add a
 * `NEXT_PUBLIC_APP_URL` this app has no other reader for yet — the presenter
 * builds the URL from `window.location.origin` at render time (see
 * `present/presenter-flow.tsx`), so it is automatically correct in dev, on a
 * Vercel preview deployment, and in production without a config value to keep
 * in sync. This is a judgment call the architecture doc did not make; see the
 * build report for the reasoning written out in full.
 *
 * WHAT THIS DOES AND DOES NOT PROVE
 * `parseConnectToken` is a SHAPE filter only — "does this look like one of our
 * connect URLs, and if so what's the token substring" — exactly analogous to
 * `cardCodeSchema`'s own comment in `packages/types`: "a cheap shape filter,
 * not a security control." The actual security is the HMAC signature the
 * `qr/redeem` route verifies server-side; a string that parses here but
 * carries a forged or expired token is refused there, generically, exactly
 * like any other bad token. This module's only job is telling "a SmartCard
 * connect code" apart from "literally anything else someone's camera saw" so
 * the scanner screen can handle that gracefully (task requirement: not a
 * connect failure, just not a code to scan).
 */

const CONNECT_PATH_PREFIX = "/c/";

/** Matches the `token` bound in `qrRedeemRequestSchema` (`packages/types`) — 1 to 4096 characters. */
const MIN_TOKEN_LENGTH = 1;
const MAX_TOKEN_LENGTH = 4096;

/** Builds the URL the presenter's QR code encodes, from the page's own origin. */
export function buildConnectUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${CONNECT_PATH_PREFIX}${encodeURIComponent(token)}`;
}

/**
 * Extracts a token from decoded QR text, or returns null when the text isn't
 * shaped like one of our connect URLs at all — including plain garbage, a
 * URL to some other site, or a `smartcard.tech/card/<code>` NFC-card link
 * (out of scope for this scanner; §4.5 handles that on tap, not on a camera
 * scan of a photographed card).
 *
 * `expectedOrigin`, when given, additionally requires the scanned URL's
 * origin to match — hygiene, not a security boundary (see the header
 * comment): it just means a well-formed-but-foreign URL is treated the same
 * as any other non-match rather than being sent to our redeem endpoint for
 * the server to reject.
 */
export function parseConnectToken(scannedText: string, expectedOrigin?: string): string | null {
  let url: URL;
  try {
    url = new URL(scannedText);
  } catch {
    return null;
  }

  if (expectedOrigin !== undefined && url.origin !== expectedOrigin) {
    return null;
  }
  if (!url.pathname.startsWith(CONNECT_PATH_PREFIX)) {
    return null;
  }

  const rawToken = url.pathname.slice(CONNECT_PATH_PREFIX.length);
  if (rawToken === "" || rawToken.includes("/")) {
    return null;
  }

  let token: string;
  try {
    token = decodeURIComponent(rawToken);
  } catch {
    return null;
  }

  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  return token;
}
