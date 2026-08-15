/**
 * Brand marks and handles for the link tiles on Profile
 * (`docs/design/DESIGN.md` §5, "Link tiles").
 *
 * WHY A LOOKUP AND NOT A COLUMN
 *
 * `social_links.platform` is free text — `packages/types/src/db/social-links.ts`
 * validates only that it is a non-empty string under 100 characters, because
 * the legacy import (§6.4) wrote whatever people had typed. So the platform a
 * row names has to be recognised at render time rather than read off an enum.
 * Anything unrecognised gets the neutral tile below rather than being hidden or
 * guessed at: §4's "never hand-draw an icon" cuts both ways, and inventing a
 * mark for an unknown platform would be worse than not having one.
 *
 * WHERE THE PATHS COME FROM
 *
 * Simple Icons, copied verbatim from the same `SI` map in
 * `docs/design/prototypes/SmartCard 2.0.dc.html` that the design was drawn
 * with, so the shipped tiles and the design artifact use identical geometry.
 * §4: "Social brand marks are Simple Icons." Adding a platform means adding its
 * Simple Icons path here, not drawing one.
 */

/** A brand mark plus the tinted plate §5 puts it on. Brand colour goes on the mark only. */
export interface SocialMark {
  /** Display name, properly cased — `platform` as typed may not be. */
  name: string;
  /** Simple Icons path data, or `null` for the neutral fallback tile. */
  path: string | null;
  /** Brand colour, applied to the mark. */
  color: string;
  /** The 32px plate behind the mark — the brand colour at 7–10% alpha. */
  tint: string;
  /** Whether this platform's handles conventionally carry an `@`. */
  atPrefixed: boolean;
}

const SIMPLE_ICONS: Record<string, SocialMark> = {
  instagram: {
    name: "Instagram",
    color: "#E4405F",
    tint: "rgba(228,64,95,.1)",
    atPrefixed: true,
    path: "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077",
  },
  x: {
    name: "X",
    color: "#0d1220",
    tint: "rgba(13,18,32,.07)",
    atPrefixed: true,
    path: "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z",
  },
  github: {
    name: "GitHub",
    color: "#181717",
    tint: "rgba(24,23,23,.07)",
    atPrefixed: false,
    path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  },
  substack: {
    name: "Substack",
    color: "#FF6719",
    tint: "rgba(255,103,25,.1)",
    atPrefixed: false,
    path: "M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z",
  },
  spotify: {
    name: "Spotify",
    color: "#1DB954",
    tint: "rgba(29,185,84,.1)",
    atPrefixed: false,
    path: "M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z",
  },
  threads: {
    name: "Threads",
    color: "#0d1220",
    tint: "rgba(13,18,32,.07)",
    atPrefixed: true,
    path: "M18.263 11.097c-.03-3.486-1.92-5.586-5.111-5.586-2.13 0-3.922.963-4.863 2.499l2.062 1.438c.535-.843 1.272-1.543 2.628-1.543 1.528 0 2.318.85 2.544 2.431a15 15 0 0 0-2.236-.173c-4.125 0-6.068 1.867-6.068 4.336s1.943 3.99 4.804 3.99c3.139 0 5.013-2.115 5.781-4.735.798.361 1.348 1.204 1.348 2.47 0 3.387-3.907 5.232-7.22 5.232-4.885 0-8.077-3.207-8.077-8.424 0-6.392 4.223-10.487 9.9-10.487 3.808 0 5.69 1.671 6.97 3.914l2.108-1.475C21.44 2.078 18.331 0 13.663 0 6.227 0 1.168 5.277 1.168 12.934c0 7 4.953 11.066 10.856 11.066 4.878 0 9.809-2.846 9.809-7.716 0-2.545-1.46-4.231-3.569-5.187m-6.33 4.855c-1.077 0-2.026-.512-2.026-1.453 0-1.483 1.822-1.934 3.606-1.934.678 0 1.34.045 1.927.173-.422 1.927-1.671 3.215-3.508 3.214Z",
  },
  dribbble: {
    name: "Dribbble",
    color: "#EA4C89",
    tint: "rgba(234,76,137,.1)",
    atPrefixed: false,
    path: "M12 24C5.385 24 0 18.615 0 12S5.385 0 12 0s12 5.385 12 12-5.385 12-12 12zm10.12-10.358c-.35-.11-3.17-.953-6.384-.438 1.34 3.684 1.887 6.684 1.992 7.308 2.3-1.555 3.936-4.02 4.395-6.87zm-6.115 7.808c-.153-.9-.75-4.032-2.19-7.77l-.066.02c-5.79 2.015-7.86 6.025-8.04 6.4 1.73 1.358 3.92 2.166 6.29 2.166 1.42 0 2.77-.29 4-.814zm-11.62-2.58c.232-.4 3.045-5.055 8.332-6.765.135-.045.27-.084.405-.12-.26-.585-.54-1.167-.832-1.74C7.17 11.775 2.206 11.71 1.756 11.7l-.004.312c0 2.633.998 5.037 2.634 6.855zm-2.42-8.955c.46.008 4.683.026 9.477-1.248-1.698-3.018-3.53-5.558-3.8-5.928-2.868 1.35-5.01 3.99-5.676 7.17zM9.6 2.052c.282.38 2.145 2.914 3.822 6 3.645-1.365 5.19-3.44 5.373-3.702-1.81-1.61-4.19-2.586-6.795-2.586-.825 0-1.63.1-2.4.285zm10.335 3.483c-.218.29-1.935 2.493-5.724 4.04.24.49.47.985.68 1.486.08.18.15.36.22.53 3.41-.43 6.8.26 7.14.33-.02-2.42-.88-4.64-2.31-6.38z",
  },
};

/**
 * The tile treatment for a platform name as the user typed it. Matching is
 * case- and punctuation-insensitive, so "Instagram", "instagram" and "IG " all
 * land on the same mark; "Twitter" maps to X, since a legacy row may well say
 * the old name for the same link.
 */
export function markFor(platform: string): SocialMark {
  const key = platform.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliased = key === "twitter" || key === "xcom" ? "x" : key === "ig" ? "instagram" : key;
  return (
    SIMPLE_ICONS[aliased] ?? {
      // §5's neutral treatment: no mark rather than a guessed one, and the
      // platform name as typed rather than a corrected version of it.
      name: platform.trim(),
      path: null,
      color: "var(--sc-text-muted)",
      tint: "rgba(13,18,32,.05)",
      atPrefixed: false,
    }
  );
}

/**
 * The handle line under a tile's platform name, derived from the stored URL.
 *
 * `social_links` stores a URL and a platform name and nothing else — there is no
 * handle column — so the design's "@jacob" has to come out of the URL or not
 * appear at all. This takes the last path segment, which is the handle for every
 * platform in the map above, and falls back to the hostname for a bare domain.
 * It is a display derivation of data the user themselves entered, not an
 * inference about them.
 *
 * A URL that does not parse returns the raw string trimmed to something
 * displayable rather than throwing: `socialLinkUrlSchema` only guards links
 * added through the app's own form, and §6.4 records that the legacy import
 * wrote malformed values into this column.
 */
export function handleFromUrl(rawUrl: string, atPrefixed: boolean): string {
  const trimmed = rawUrl.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed.slice(0, 60);
  }

  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const last = segments.at(-1);
  if (last === undefined) {
    return url.hostname.replace(/^www\./, "");
  }

  const decoded = safeDecode(last).replace(/^@/, "");
  if (decoded === "") {
    return url.hostname.replace(/^www\./, "");
  }
  return atPrefixed ? `@${decoded}` : decoded;
}

/** A path segment can carry a stray `%`, which `decodeURIComponent` throws on. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
