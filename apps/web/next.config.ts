import type { NextConfig } from "next";

/**
 * The origin signed Storage URLs are served from, for `img-src`.
 *
 * Derived from `SUPABASE_URL` rather than hardcoded, so a preview or a future
 * project migration does not silently stop rendering every photo. Declared on
 * `turbo.json`'s build task, so it is present here — but this falls back to the
 * Supabase apex wildcard rather than throwing if it ever is not, because a CSP
 * that fails the BUILD is a worse outcome than a CSP one wildcard wider.
 */
function supabaseImageOrigin(): string {
  const raw = process.env.SUPABASE_URL?.trim();
  if (raw === undefined || raw === "") return "https://*.supabase.co";
  try {
    return new URL(raw).origin;
  } catch {
    return "https://*.supabase.co";
  }
}

/**
 * Content-Security-Policy.
 *
 * WHAT EACH DIRECTIVE IS ACTUALLY FOR — none of these is boilerplate.
 *
 *   frame-ancestors 'none'   The one that matters most for this app, and the
 *                            reason a header pass could not wait. `/connect`
 *                            asks the browser for CAMERA and GEOLOCATION. A
 *                            page that can iframe SmartCard can attempt to
 *                            drive those prompts under its own framing — and
 *                            more simply, can clickjack "remove connection" or
 *                            "revoke card", both one-click destructive actions
 *                            behind an authenticated cookie. `X-Frame-Options`
 *                            below says the same thing for older agents.
 *
 *   connect-src 'self'       The app makes NO cross-origin requests from the
 *                            browser: Supabase is reached only server-side (the
 *                            minted token never leaves the server), and the
 *                            connect endpoints are same-origin. So this is not
 *                            a guess about what the app needs — it is the
 *                            complete list, which makes it a real exfiltration
 *                            bound rather than a formality.
 *
 *   img-src                  Signed Storage URLs, plus `blob:`/`data:` for the
 *                            camera preview and the local photo preview before
 *                            upload.
 *
 *   base-uri / form-action   Close the two redirect-ish holes an injected tag
 *                            would otherwise open: rewriting every relative URL
 *                            on the page, and re-pointing a form (including a
 *                            Server Action POST) at somebody else's origin.
 *
 *   object-src 'none'        No plugin content, ever.
 *
 * THE HONEST LIMITATION: `script-src` CARRIES 'unsafe-inline'.
 * Next.js's App Router streams hydration data as inline `<script>` tags. Making
 * those nonce-able requires generating a per-request nonce in a `middleware.ts`
 * and threading it through, which would put a new piece of code on EVERY
 * request including the Kinde auth callbacks — a change with its own risk that
 * should be made deliberately, not folded into a header pass. So this CSP is
 * not an XSS defence today, and it is written down here rather than implied by
 * the presence of a CSP header.
 *
 * What makes that acceptable for now, and what would change it: this app has
 * essentially no XSS sink to defend. There is exactly ONE `dangerouslySetInnerHTML`
 * in the app — `components/local-timestamp.tsx`, which injects an inline
 * timestamp-correction script whose only interpolated values are a React
 * `useId()` and a DB timestamp, both serialized through a `<`-escaping
 * `JSON.stringify` so neither can close the tag (see that file). No
 * `innerHTML`/`eval`/`new Function` anywhere in `apps/web` or `packages/`, and
 * no user-supplied HTML is rendered anywhere. (An earlier version of this
 * comment claimed *zero* `dangerouslySetInnerHTML`; that stopped being true when
 * the timestamp component landed, and was corrected in the 2026-08 security
 * audit. The one sink is safe, but it means this CSP is genuinely not an XSS
 * *defence* — a future unsafe sink would not be caught. Making it one is the
 * nonce work below.) Note the session itself is already out of reach of injected
 * script regardless: the Kinde cookie is HttpOnly and the Supabase token is
 * never sent to the browser.
 */
function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    // Tailwind and Radix both set inline styles at runtime.
    "style-src 'self' 'unsafe-inline'",
    // `next/font` self-hosts Geist at build time — no external font origin.
    "font-src 'self'",
    `img-src 'self' blob: data: ${supabaseImageOrigin()}`,
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Applied to every route, including `/api/connect/*` and `/card/[code]`.
 *
 * On HSTS: Vercel already sends `Strict-Transport-Security` for its own
 * domains, so this is belt-and-braces for the custom domain (`smartcard.tech`,
 * §9 Q15) once DNS points here. `includeSubDomains` and `preload` are both
 * deliberate — but note `preload` is a one-way door in practice, since removal
 * from the browser preload list takes months. It is the right call for a domain
 * that will only ever serve this app over HTTPS.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  // Redundant with `frame-ancestors` for modern browsers, kept for older ones.
  { key: "X-Frame-Options", value: "DENY" },
  // Stops a response being re-interpreted as a type it did not declare — most
  // relevant for the image bytes this app serves back through signed URLs.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // A path here can carry a card code or a connection id. Sending a full URL to
  // a third party in a `Referer` would leak both; this sends only the origin
  // cross-site, and nothing at all when downgrading to HTTP.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    // Deny every powerful feature by default, then hand back exactly the two
    // this product exists to use, to our own origin only (§4.2/§4.3: the QR
    // scan needs the camera, and the GPS gate needs a real fix). Naming the
    // denials explicitly is the point — `geolocation=(self)` is what stops an
    // embedder inheriting the permission that the entire proximity gate rests
    // on.
    key: "Permissions-Policy",
    value: [
      "camera=(self)",
      "geolocation=(self)",
      "microphone=()",
      "payment=()",
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "midi=()",
      "serial=()",
      "bluetooth=()",
      "interest-cohort=()",
    ].join(", "),
  },
];

const nextConfig: NextConfig = {
  // These are workspace packages (packages/core, packages/types,
  // packages/api-client) exporting untranspiled TypeScript source directly —
  // Next.js only transpiles files inside apps/web by default, so anything
  // imported from node_modules (including pnpm workspace symlinks) needs to
  // be listed here or the build fails on the raw `.ts` syntax.
  transpilePackages: ["@smartcard/core", "@smartcard/types", "@smartcard/api-client"],
  experimental: {
    serverActions: {
      // The `profile-photos` Storage bucket caps objects at 5MB
      // (20260813180355_create_profile_photos_bucket.sql) and
      // `uploadPhotoAction` (apps/web/src/app/profile/actions.ts) posts the
      // file straight through as multipart form data — the default 1MB
      // Server Action body limit would reject a legitimately-sized photo
      // before it ever reached that check. 6MB leaves room for multipart
      // boundary/header overhead on top of the 5MB payload (see this
      // option's own doc: "an additional 10-20KB is a reasonable rule of
      // thumb" — 6MB is deliberately generous rather than cutting it close).
      bodySizeLimit: "6mb",
    },
  },

  // `source: "/:path*"` is every route, deliberately — including the API routes
  // and `/card/[code]`. There is no page in this app that should be framable or
  // should hand a powerful feature to an embedder, so there is no exception to
  // carve out.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
