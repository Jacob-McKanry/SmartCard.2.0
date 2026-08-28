import type { CSSProperties } from "react";

/**
 * A local copy of the glass-panel and button tokens
 * `(app)/events/lib/surfaces.ts` assembles, for this route only.
 *
 * WHY THIS IS A SEPARATE FILE RATHER THAN AN IMPORT FROM THAT ONE
 *
 * `/claim/[token]` lives outside the `(app)` route group on purpose — it has
 * to render for a signed-out visitor and self-redirect after Kinde sign-in,
 * the same reason `/card/[code]` and `/c/[token]` sit outside it too. Those
 * two routes set the precedent this file follows: `non-user-preview.tsx`
 * defines its own local `glassSurface` rather than reaching into the Events
 * feature's style module. Reaching into `(app)/events/lib/surfaces.ts` from
 * here would couple a route with no auth dependency on Events to one that
 * has it, for four CSS objects assembled from tokens already defined
 * globally in `globals.css` — the underlying `--sc-*` custom properties are
 * shared; only this small assembly is duplicated, same trade `non-user-preview.tsx`
 * already made.
 */

export const GLASS: CSSProperties = {
  background: "var(--sc-glass-bg)",
  backdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  WebkitBackdropFilter: "blur(var(--sc-glass-blur)) saturate(1.6)",
  border: "1px solid var(--sc-glass-bd)",
  boxShadow: "var(--sc-glass-sh)",
};

export const PRIMARY_BUTTON: CSSProperties = {
  background: "linear-gradient(150deg, var(--sc-accent), var(--sc-accent-deep))",
  color: "#ffffff",
  boxShadow: "0 14px 30px -10px rgba(11,96,255,.55)",
};

export const SECONDARY_BUTTON: CSSProperties = {
  background: "rgba(255,255,255,.65)",
  border: "1px solid rgba(13,18,32,.12)",
  color: "var(--sc-text)",
};
